import * as vscode from 'vscode';
import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';

interface Quote {
  text: string;
}

class Crawler {
  private searchEngine = new SearchEngine();
  private webScraper = new WebScraper();

  async searchAndScrape(keyword: string): Promise<string[]> {
    try {
      // 显示进度通知
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Searching web content...",
        cancellable: false
      }, async () => {
        return new Promise<void>(resolve => setTimeout(resolve, 500));
      });

      // 使用搜索引擎获取相关 URL
      const urls = await this.searchEngine.search(keyword);
      if (urls.length === 0) {
        vscode.window.showInformationMessage('No search results found.');
        return [];
      }

      // 收集内容
      let contentList: string[] = [];
      for (const url of urls) {
        try {
          const content = await this.webScraper.scrape(url);
          contentList = contentList.concat(content);
        } catch (error) {
          vscode.window.showWarningMessage(`Failed to scrape: ${url}`);
        }
      }

      return contentList;
    } catch (error) {
      vscode.window.showErrorMessage(`Crawler failed: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}

class SearchEngine {
  async search(keyword: string): Promise<string[]> {
    try {
      // 使用百度搜索
      const searchUrl = `https://www.baidu.com/s?wd=${encodeURIComponent(keyword)}`;
      
      // 使用 VS Code 的 fetch API
      const response = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Fetching search results...",
        cancellable: false
      }, async () => {
        return fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cookie': 'BAIDUID_BFESS=EC84D1232C0F9E38BCA8EBF6C6B8964D:FG=1;'
          }
        });
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // 提取搜索结果中的 URL
      const urls: string[] = [];
      $('.t a').each((_index: any, element: any) => {
        const url = $(element).attr('href');
        if (url && url.startsWith('http')) {
          urls.push(url);
        }
      });

      // 限制最多 5 个结果
      return urls.slice(0, 5);
    } catch (error) {
      vscode.window.showErrorMessage(`Search failed: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}

class WebScraper {
  async scrape(url: string): Promise<string[]> {
    try {
      // 使用 VS Code 的 fetch API
      const response = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Scraping: ${new URL(url).hostname}`,
        cancellable: false
      }, async () => {
        return fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      return this.extractContent(html);
    } catch (error) {
      throw new Error(`Scrape failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private extractContent(html: string): string[] {
    const $ = cheerio.load(html);

    // 移除无关内容
    $('script, style, iframe, noscript, header, footer, nav, aside, .ad, .ads').remove();

    // 提取主要内容
    const contentBlocks: string[] = [];
    $('body p, body pre, body article, body .content').each((_index, element) => {
      const text = $(element).text().trim();
      if (text.length > 100) { // 只保留有意义的文本块
        contentBlocks.push(text);
      }
    });

    // 如果没有找到内容块，尝试从整个 body 提取
    if (contentBlocks.length === 0) {
      const bodyText = $('body').text().trim();
      if (bodyText.length > 100) {
        contentBlocks.push(bodyText);
      }
    }

    // 返回前 3 个最长的内容块
    return contentBlocks
      .sort((a, b) => b.length - a.length)
      .slice(0, 3)
      .map(text => 
        text.replace(/[\r\n\t]+/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .substring(0, 2000) // 限制长度
      );
  }
}

export const crawler = new Crawler();