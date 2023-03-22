const cohere = require('cohere-ai')
const cheerio = require('cheerio')
const { v4: uuidv4 } = require('uuid')

const HEADERS = [ 'h1', 'h2', 'h3', 'h4', 'h5', 'h6' ];

function getFullTextConfig(fieldName) {
  return {
    field_name: fieldName,
    field_schema: {
      type: 'text',
      tokenizer: 'prefix',
      min_token_len: 2,
      max_token_len: 20,
      lowercase: true
    }
  }
}

async function generateVectors(texts) {
  const { body: { embeddings: textsVectors } } = await cohere.embed({
    texts,
    model: 'multilingual-22-12'
  })
  return textsVectors
};

function generateDataPoints(texts, textsVectors) {
  const dataPoints = texts.map((text, idx) => ({
    id: uuidv4(),
    payload: text,
    vector: textsVectors[idx]
  }))
  return dataPoints
};

function checkHeader (elem) {
  return HEADERS.some(header => elem === header);
};

function extractTextsFromPage(pageData) {
  const $ = cheerio.load(pageData.render)
  let currentHeader;
  // console.log('page data', pageData);

  const pageElements = $(`${HEADERS.join()}, .content`).map(function (i, el) {
    const PILCROW_SYMBOL = /\u00b6/;
    const isHeader = checkHeader(el.tagName);
    const text = $(this).text().replace(/\n/g, '').replace(PILCROW_SYMBOL, '').trim().replace(/ +/g, ' ');
    if (isHeader) {
      currentHeader = { id: el.attribs.id, content: text }
    }
    return {
      id: el.attribs.id,
      type: isHeader ? 'header' : el.tagName,
      content: text,
      ...!isHeader ? { headerContent: currentHeader.content } : {},
      ...!isHeader ? { headerId: currentHeader.id } : {},
      pageTitle: pageData.title,
      pageUrl: pageData.path
    }
  }).get()

  pageElements.push({
    pageTitle: pageData.title,
    pageUrl: pageData.path
  })

  return pageElements;
};

module.exports = {
  getFullTextConfig,
  generateVectors,
  generateDataPoints,
  extractTextsFromPage,
}
