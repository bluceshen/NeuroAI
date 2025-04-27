import * as lancedb from "@lancedb/lancedb"
import { IntoVector } from "@lancedb/lancedb/dist/arrow"
import fs from "fs"
import ignore from "ignore"
import path from "path"
import * as vscode from "vscode"

import { API_PROVIDERS } from "../../common/constants"
import {
  EmbeddedDocument,
  Embedding,
  LMStudioEmbedding,
  RequestOptionsOllama,
  StreamRequestOptions as RequestOptions
} from "../../common/types"

import { Base } from "../public/base"
import { fetchEmbedding } from "../serve_func/llm"
import { TwinnyProvider } from "../serve_func/provider-manager"
import { getDocumentSplitChunks, readGitSubmodulesFile } from "../public/utils"
//*
export class EmbeddingDatabase extends Base {
  private _documents: EmbeddedDocument[] = []
  private _filePaths: EmbeddedDocument[] = []
  private _db: lancedb.Connection | null = null
  private _dbPath: string
  private _workspaceName = vscode.workspace.name || ""
  private _documentTableName = `${this._workspaceName}-documents`
  private _filePathTableName = `${this._workspaceName}-file-paths`
  private _webDocuments: EmbeddedDocument[] = []; // 新增：存储Web数据的嵌入
  private _webDocumentTableName = `${this._workspaceName}-web-documents`; // 新增：Web数据表名

  constructor(dbPath: string, context: vscode.ExtensionContext) {
    super(context)
    this._dbPath = dbPath
  }

  public async connect() {
    try {
      this._db = await lancedb.connect(this._dbPath)
    } catch (e) {
      console.error(e)
    }
  }

  public async fetchModelEmbedding(content: string) {
    const provider = this.getEmbeddingProvider()

    if (!provider) return

    const requestBody: RequestOptionsOllama = {
      model: provider.modelName,
      input: content,
      stream: false,
      options: {}
    }

    const requestOptions: RequestOptions = {
      hostname: provider.apiHostname || "localhost",
      port: provider.apiPort,
      path: provider.apiPath || "/api/embed",
      protocol: provider.apiProtocol || "http",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`
      }
    }

    return new Promise<number[]>((resolve) => {
      fetchEmbedding({
        body: requestBody,
        options: requestOptions,
        onData: (response) => {
          resolve(this.getEmbeddingFromResponse(provider, response))
        }
      })
    })
  }

  private getAllFilePaths = async (dirPath: string): Promise<string[]> => {
    let filePaths: string[] = []
    const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true })
    const submodules = readGitSubmodulesFile()

    const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""

    const ig = ignore()

    const gitIgnoreFilePath = path.join(rootPath, ".gitignore")

    if (fs.existsSync(gitIgnoreFilePath)) {
      ig.add(fs.readFileSync(gitIgnoreFilePath).toString())
    }

    const embeddingIgnoredGlobs = this.config.get(
      "embeddingIgnoredGlobs",
      [] as string[]
    )

    ig.add(embeddingIgnoredGlobs)
    ig.add([".git", ".gitignore"])

    for (const dirent of dirents) {
      const fullPath = path.join(dirPath, dirent.name)
      const relativePath = path.relative(rootPath, fullPath)

      if (submodules?.some((submodule) => fullPath.includes(submodule))) {
        continue
      }

      if (ig.ignores(relativePath)) {
        continue
      }

      if (dirent.isDirectory()) {
        filePaths = filePaths.concat(await this.getAllFilePaths(fullPath))
      } else if (dirent.isFile()) {
        filePaths.push(fullPath)
      }
    }
    return filePaths
  }

  public async injestDocuments(
    directoryPath: string
  ): Promise<EmbeddingDatabase> {
    const filePaths = await this.getAllFilePaths(directoryPath)
    const totalFiles = filePaths.length
    let processedFiles = 0

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Embedding",
        cancellable: true
      },
      async (progress) => {
        if (!this.context) return
        const promises = filePaths.map(async (filePath) => {
          const content = await fs.promises.readFile(filePath, "utf-8")

          const chunks = await getDocumentSplitChunks(
            content,
            filePath,
            this.context
          )

          const filePathEmbedding = await this.fetchModelEmbedding(filePath)

          this._filePaths.push({
            content: filePath,
            vector: filePathEmbedding,
            file: filePath
          })

          for (const chunk of chunks) {
            const chunkEmbedding = await this.fetchModelEmbedding(chunk)
            if (this.getIsDuplicateItem(chunk, chunks)) return
            this._documents.push({
              content: chunk,
              vector: chunkEmbedding,
              file: filePath
            })
          }

          processedFiles++
          progress.report({
            message: `${((processedFiles / totalFiles) * 100).toFixed(
              2
            )}% (${filePath.split("/").pop()})`
          })
        })

        await Promise.all(promises)

        vscode.window.showInformationMessage(
          `Embedded successfully! Processed ${totalFiles} files.`
        )
      }
    )

    return this
  }

  public async populateDatabase() {
    try {
      const tableNames = await this._db?.tableNames()
      if (!tableNames?.includes(`${this._workspaceName}-documents`)) {
        await this._db?.createTable(
          this._documentTableName,
          this._documents,
          {
            mode: "overwrite"
          }
        )
      }

      if (!tableNames?.includes(`${this._workspaceName}-file-paths`)) {
        await this._db?.createTable(
          this._filePathTableName,
          this._filePaths,
          {
            mode: "overwrite"
          }
        )
        return
      }

      await this._db?.dropTable(`${this._workspaceName}-documents`)
      await this._db?.dropTable(`${this._workspaceName}-file-paths`)
      await this.populateDatabase()

      this._documents.length = 0
      this._filePaths.length = 0
    } catch (e) {
      console.log("Error populating database", e)
    }
  }

  public async hasEmbeddingTable(name: string): Promise<boolean | undefined> {
    const tableNames = await this._db?.tableNames()
    return tableNames?.includes(name)
  }

  public async getDocuments(
    vector: IntoVector,
    limit: number,
    tableName: string,
    where?: string
  ): Promise<EmbeddedDocument[] | undefined> {
    try {
      const table = await this._db?.openTable(tableName)
      const query = table?.vectorSearch(vector).limit(limit)
      if (where) query?.where(where)
      return query?.toArray()
    } catch {
      return undefined
    }
  }

  public async getDocumentByFilePath(filePath: string) {
    const content = await fs.promises.readFile(filePath, "utf-8")
    const contentSnippet = content?.slice(0, 500)
    return contentSnippet
  }

  private getIsDuplicateItem(item: string, collection: string[]): boolean {
    return collection.includes(item.trim().toLowerCase())
  }

  private getEmbeddingFromResponse<T>(
    provider: TwinnyProvider,
    response: T
  ): number[] {
    if (provider.provider === API_PROVIDERS.LMStudio) {
      return (response as LMStudioEmbedding).data?.[0].embedding
    }

    return (response as Embedding).embeddings[0]
  }

  // 新增：嵌入Web数据的方法
<<<<<<< HEAD
  public async injestWebDocuments(webData: string[], _path:undefined|string): Promise<EmbeddingDatabase> {
=======
  public async injestWebDocuments(webData: string[], directoryPath: string): Promise<EmbeddingDatabase> {
>>>>>>> 9be0b62f3ce99cbf4e8f26836b89cba07f72b672
    const totalFiles = webData.length;
    let processedFiles = 0;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Embedding Web Data",
        cancellable: true,
      },
      async (progress) => {
        if (!this.context) return;
        const promises = webData.map(async (content) => {
          const chunks = await getDocumentSplitChunks(content, `web-${processedFiles}`, this.context);

          for (const chunk of chunks) {
            const chunkEmbedding = await this.fetchModelEmbedding(chunk);
            this._webDocuments.push({
              content: chunk,
              vector: chunkEmbedding,
              file: `web-${processedFiles}`,
            });
          }

          processedFiles++;
          progress.report({
            message: `${((processedFiles / totalFiles) * 100).toFixed(2)}%`,
          });
        });

        await Promise.all(promises);

        vscode.window.showInformationMessage(`Embedded Web Data successfully! Processed ${totalFiles} items.`);
      }
    );

    return this;
  }

  // 新增：将Web数据写入数据库的方法
  public async populateWebDatabase() {
    try {
      const tableNames = await this._db?.tableNames();
      if (!tableNames?.includes(this._webDocumentTableName)) {
        await this._db?.createTable(this._webDocumentTableName, this._webDocuments, {
          mode: "overwrite",
        });
        return;
      }

      await this._db?.dropTable(this._webDocumentTableName);
      await this.populateWebDatabase();

      this._webDocuments.length = 0;
    } catch (e) {
      console.log("Error populating Web database", e);
    }
  }

  // 新增：从数据库中检索Web数据的方法
  public async getWebDocuments(vector: IntoVector, limit: number): Promise<EmbeddedDocument[] | undefined> {
    try {
      const table = await this._db?.openTable(this._webDocumentTableName);
      const query = table?.vectorSearch(vector).limit(limit);
      return query?.toArray();
    } catch {
      return undefined;
    }
  }
<<<<<<< HEAD
}
=======
}
>>>>>>> 9be0b62f3ce99cbf4e8f26836b89cba07f72b672
