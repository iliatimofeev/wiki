const _ = require('lodash')
// const stream = require('stream')
// const Promise = require('bluebird')
// const pipeline = Promise.promisify(stream.pipeline)

const { Qdrant } = require('./qdrantapi')
const cohere = require('cohere-ai')

const {
  getFullTextConfig,
  generateVectors,
  generateDataPoints,
  extractTextsFromPage,
} = require('./utils');

/* global WIKI */
const COLLECTION_NAME = 'test_collection';
const NUMBER_OF_RESULTS = 7;
const HNSW_EF_VALUE = 128;

const schema = {
  name: COLLECTION_NAME,
  vectors: {
    size: 768,
    distance: 'Dot'
  }
}

module.exports = {
  async activate() {
    // not used
  },
  async deactivate() {
    // not used
  },
  /**
   * INIT
   */
  async init() {
    WIKI.logger.info(`(SEARCH/qdrant) Initializing...`)
    WIKI.logger.info(JSON.stringify(this.config))

    try {
      WIKI.logger.info(`(SEARCH/QDRANT) Initializing...`)
      cohere.init(this.config.cohereApiKey)

      this.client = new Qdrant(this.config.qdrantHostName, this.config.qdrantApiKey)

      const createResult = await this.client.createCollection(COLLECTION_NAME, schema)
      if (createResult.err) {
        console.error(`ERROR:  Couldn't create collection "${COLLECTION_NAME}"!`)
        console.error(createResult.err)
      } else {
        // console.log(`Success! Collection "${COLLECTION_NAME} created!"`);
        // console.log(createResult.response);
      }

      WIKI.logger.info(`(SEARCH/QDRANT) Initialization completed.`)
    } catch (err) {
      console.error(err)
    }
  },
  async created(page) {

  },
  async updated(page) {

  },
  async deleted(page) {

  },
  async renamed(page) {

  },
  async query(q, opts) {
    console.log('opts', opts.path)
    try {
      const queryVector = await generateVectors([q])
      console.log('queryVector: ', queryVector)

      let vectorResult = await this.client.searchCollection(
        COLLECTION_NAME,
        queryVector[0],
        NUMBER_OF_RESULTS,
        HNSW_EF_VALUE
      )
      if (vectorResult.err) {
        console.error(`ERROR: Couldn't search ${queryVector}`)
        console.error(vectorResult.err)
        throw new Error('Search  by vector')
      }
      const query = {
        'filter': {
          'should': [
            { 'key': 'content', 'match': { 'text': q } },
            { 'key': 'headerText', 'match': { 'text': q } }
          ]
        },
        'top': 3,
        'vector': queryVector[0],
        'with_payload': true
      }
      const textResults = await this.client.queryCollection(COLLECTION_NAME, query)
      if (textResults.err) {
        console.error(`ERROR: Couldn't search ${q}`)
        console.error(textResults.err)
        throw new Error('Search  by text')
      }
      // merge the results with unique ids
      const results = _.uniqBy([...vectorResult.response.result, ...textResults.response.result], 'id')
      return {
        results: results.map(result => {
          const {
            id,
            // type,
            content,
            // headerContent,
            // headerId,
            pageTitle,
            pageUrl
          } = result.payload

          if (content) { // if there is not content then 'result' is just the title
            return {
              id: `${pageUrl}_${id}`,
              title: pageTitle,
              description: content,
              path: `${pageUrl}#${id}`, // query string is for the highlighting animation, hash is for scrolling to the element on page load.
              locale: 'en'
            }
          } else {
            return {
              id: pageUrl,
              title: pageTitle,
              description: 'Page',
              path: pageUrl,
              locale: 'en'
            }
          };
        }),
        suggestions: [],
        totalHits: results.length
      }
    } catch (err) {
      WIKI.logger.warn('Search Engine Error:')
      WIKI.logger.warn(err)
    }
  },
  /**
 * REBUILD INDEX
 */
  async rebuild() {
    try {
      WIKI.logger.info(`(SEARCH/QDRANT) Rebuilding index...`)

      // query for the contents in the db
      const pagesRaw = await WIKI.models.knex.column('path', 'localeCode', 'title', 'description', 'render')
        .select()
        .from('pages')
        .where({
          isPublished: true,
          isPrivate: false
        })
        .returning('*')

      const pagesElements = pagesRaw.map(page => extractTextsFromPage(page)); // complete data for every indexable element in a page
      const pagesContents = pagesElements.flat().map(p => p.content ? p.content : p.pageTitle); // only the texts
      const vectors = await generateVectors(pagesContents);
      const dataPoints = generateDataPoints(pagesElements.flat(), vectors);
      console.log('data points', dataPoints);

      // delete collection in qdrant db
      const deleteResult = await this.client.deleteCollection(COLLECTION_NAME)
      if (deleteResult.err) {
        console.error(`ERROR:  Couldn't delete collection "${COLLECTION_NAME}"!`)
        console.error(deleteResult.err)
      } else {
        console.log(`Success! Collection "${COLLECTION_NAME} deleted!"`)
        // console.log(create_result.response);
      }

      // create collection again in qdrant db
      let createResult = await this.client.createCollection(COLLECTION_NAME, schema)
      if (createResult.err) {
        throw new Error(`ERROR:  Couldn't create collection "${COLLECTION_NAME}"!`)
      }

      createResult = await this.client.indexCollection(COLLECTION_NAME, getFullTextConfig('content'))
      if (createResult.err) {
        throw new Error(`ERROR:  Couldn't create text index for content!`)
      }
      createResult = await this.client.indexCollection(COLLECTION_NAME, getFullTextConfig('pageTitle'))
      if (createResult.err) {
        throw new Error(`ERROR:  Couldn't create text index for pageTitle!`)
      }
      console.log(`Success! Collection "${COLLECTION_NAME} created!"`)

      // upload datapoints to newly created collection
      const uploadResult = await this.client.uploadPoints(COLLECTION_NAME, dataPoints)

      if (uploadResult.err) {
        console.error(`ERROR:  Couldn't create collection "${COLLECTION_NAME}"!`)
        console.error(uploadResult.err)
      } else {
        console.log(`Success! Data points were uploaded!"`)
        // console.log(uploadResult.response);
      }

      WIKI.logger.info(`(SEARCH/QDRANT) Index was rebuilt...`)
    } catch (err) {
      console.error(err)
    }
  }
}
