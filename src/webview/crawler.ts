import superagent from 'superagent';
const cheerio = require('cheerio');
import fs from 'fs';
import path from 'path';

interface Quote {
  text: string;
  author: string;
  tagList: Array<string>;
}

interface QuoteData {
  time: number,
  data: Array<Quote>
}

class Crawler {
  private searchEngine = new SearchEngine();
  private webScraper = new WebScraper();

  constructor() {
    this.init();
  }

  async init() {
    const action = process.argv[2];
    const keyword = process.argv[3];

    if (action === 'search') {
      if (!keyword) {
        console.error('Please provide a keyword for searching.');
        return;
      }
      console.log(`Searching for keyword: ${keyword}`);
      await this.searchAndScrape(keyword);
    } else {
      console.log("Invalid action. Use 'search' to search and scrape content.");
    }
  }

  async searchAndScrape(keyword: string) {
    // 使用搜索引擎获取相关 URL
    const urls = await this.searchEngine.search(keyword);
    if (urls.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log('Found URLs:', urls);

    let List: Array<String> = [];
    // 爬取每个 URL 的内容
    for (const url of urls) {
      console.log(`Scraping content from: ${url}`);
      const content = await this.webScraper.scrape(url);
      for (const item of content) {
        List.push(item);
      }
    }

    return List;
  }
}

class SearchEngine {
  private endpoint = 'https://www.baidu.com/s';

  async search(keyword: string): Promise<string[]> {
    try {
      const result = await superagent
        .get(this.endpoint)
        .query({ wd: keyword })
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36')
        .set('Accept-Language', 'zh-CN,zh;q=0.9')
        .set('Connection', 'keep-alive')
        .set('Cookie', 'BAIDUID_BFESS=EC84D1232C0F9E38BCA8EBF6C6B8964D:FG=1; __bid_n=19509198bcc92963e12039; ab_jid=e12911916a20c4155f220ba1d9309bc34ced; ab_jid_BFESS=e12911916a20c4155f220ba1d9309bc34ced; BDUSS=VpLWVcwaWUzOVZqVHdTNHNIR3JFUy1HSjZ-Sm9wdnJzeVJtTzUzSHkxZGFQeFJvSVFBQUFBJCQAAAAAAQAAAAEAAABVerxGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFqy7Gdasuxnd; BDUSS_BFESS=VpLWVcwaWUzOVZqVHdTNHNIR3JFUy1HSjZ-Sm9wdnJzeVJtTzUzSHkxZGFQeFJvSVFBQUFBJCQAAAAAAQAAAAEAAABVerxGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFqy7Gdasuxnd; BAIDU_WISE_UID=wapp_1744810728921_223; ZFY=63l2XNYQm:Bk7ikZlqS46b40Ysje1OHP0HE6hbB4uRyI:C; newlogin=1; ab_bid=3adcbd04ed6d45fc9ff13afde77db50c779e; ab_sr=1.0.1_YzMyYWQ5Mjg0MWE1OGU5NTU0ZTdiMzEwNDEyZGJmN2ViZjUzOWMxZWVhYmRhMTM0NzcxYzA2YTM0NGQ2MzhmNjI5ZmI5MmIwZWUxMGU0NWJiYWRhZmQ3OTZiNTZmMDY5MzQ0NzA5Yjk1N2EzYjg0MDNmYjg2MjI4Yzc2Nzg0MDIxMjQ5MzgzMzBjMGJiNzdkZGNkMjRlMDIwYTY0ZWMwNTM5MGE0YmNjMjNiNjI2YTc0Njg0YmYzMDA3Mzc5NGUwZjBiMmYzYTllNzE2ODhlMWExNDIzZDg3MTZkYjBmOGM=');

      const html = result.text;
      const $ = cheerio.load(html);

      // 提取搜索结果中的 URL
      const urls: string[] = [];
      $('.t a').each((_index: any, element: any) => {
        const url = $(element).attr('href');
        if (url) {
          urls.push(url);
        }
      });

      if (urls.length === 0) {
        console.log('No URLs found. Please check the HTML structure or your query.');
      }

      return urls;
    } catch (error) {
      console.error('Error fetching search results:', error);
      return [];
    }
  }
}

class WebScraper {
  async scrape(url: string): Promise<string> {
    try {
      // 允许自动跳转
      const result = await superagent.get(url);
      const html = result.text;

      // 调用 getQuoteData 提取数据
      const quoteList = this.getQuoteData(html);

      // 保存数据到文件
      // this.saveJson(quoteList);

      // 返回提取的内容
      return JSON.stringify(quoteList, null, 2);
    } catch (error) {
      console.error(`Error fetching HTML content from ${url}:`, error);
      return '';
    }
  }

  getQuoteData(html: string) {
    const $ = cheerio.load(html);

    // 移除无关内容（如广告、侧边栏、页脚、脚本和样式）
    $('.ads, .sidebar, .footer, .header, .img, script, style').remove();

    // 提取主要内容区域中的段落
    const paragraphs = $('p, pre, code, div') // 提取 <p>、<pre> 和 <code> 标签中的内容
      .map((_index: any, element: any) => $(element).text().trim()) // 获取文本并去除首尾空白
      .get() // 转换为数组
      .filter((paragraph: string) => paragraph.length > 2000); // 过滤掉长度小于 500 的段落

    // 将提取的段落封装为数据结构
    let quoteList: Array<Quote> = paragraphs.map((paragraph: any) => ({
      text: paragraph
        .trim() // 去除首尾空白
        .replace(/[\r\n]+/g, ' ') // 去掉所有换行符（包括 \r 和 \n）
        .replace(/\s+/g, ' '), // 将多个空格合并为一个空格
    }));

    // 对数据进行排序（按段落长度降序排序）
    quoteList = quoteList.sort((a, b) => b.text.length - a.text.length);

    // 只保留前三个数据
    quoteList = quoteList.slice(0, 3);

    return quoteList;
  }

  saveJson(quoteInfo: QuoteData) {
    const filePath = path.resolve(__dirname, `../data/quotes_${quoteInfo.time}.json`);
    // 检查数据是否为空
    if (!quoteInfo || !quoteInfo.data) {
      console.log("No data to save.");
      return;
    }
    // 检查数据数组是否为空
    if (quoteInfo.data.length === 0) {
      console.log("No quotes found.");
      return;
    }

    // 检查目录是否存在
    // 如果目录不存在，创建目录
    if (!fs.existsSync(path.resolve(__dirname, '../data'))) {
      fs.mkdirSync(path.resolve(__dirname, '../data'));
    }

    // 检查文件是否存在
    if (fs.existsSync(filePath)) {
      console.log(`File already exists: ${filePath}`);
      // 如果文件存在，读取文件内容
      const existingData = fs.readFileSync(filePath, 'utf-8');
      const existingQuoteInfo = JSON.parse(existingData) as QuoteData;
      // 合并数据
      existingQuoteInfo.data = existingQuoteInfo.data.concat(quoteInfo.data);
      // 保存合并后的数据
      fs.writeFileSync(filePath, JSON.stringify(existingQuoteInfo, null, 2));
    } else {
      // 如果文件不存在，创建新文件
      console.log(`Creating new file: ${filePath}`);
      // 保存数据到文件
      fs.writeFileSync(filePath, JSON.stringify(quoteInfo, null, 2));
    }
  }
}

export const crawler = new Crawler();