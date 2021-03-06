const es = require('elasticsearch');
const fs = require('fs');
const rsvp = require('rsvp');
const _ = require('lodash');
const esClient = new es.Client({
  host: 'localhost:9200',
  log: 'error'
});
const search = require('craigslist-searcher').search;
const subdomains = JSON.parse(fs.readFileSync('./cl-subdomains-test.json', 'utf-8'));
const category = 'ata';
const categories = [
  'ata', // antiques
  'ppa', // appliances
  'ara', // arts+crafts
  'sna', // atvs/utvs/snow
  'pta', // auto parts
  'baa', // baby+kids
  'bar', // barter
  'haa', // beauty+hlth
  'bip', // bike parts
  'bia', // bikes
  'bpa', // boat parts
  'bka', // books
  'ema', // cds/dvd/vhs
  'moa', // cell phones
  'cla', // clothes+acc
  'cba', // collectibles
  'syp', // computer parts
  'sya', // computers
  'ela', // electronics
  'gra', // farm+garden
  'zip', // free stuff
  'fua', // furniture
  'gms', // garage sales
  'foa', // general
  'hva', // heavy equipment
  'hsa', // household
  'jwa', // jewelry
  'maa', // materials
  'mpa', // motorcycle parts
  'msa', // music instr
  'pha', // photo+video
  'sga', // sporting
  'tia', // tickets
  'tla', // tools
  'taa', // toys+games
  'vga' // video gaming
];

function decodeAsciiApostrophes(string) {
  return string.replace(/&#39;/g, '\'');
}

function getPromisesByCity(city, categoryIndex, offset, resultsArray) {
  const options = {
    city,
    offset,
    category: categories[categoryIndex]
  };
  console.log(`Searching postings in '${city}' under category '${categories[categoryIndex]}'`)
  return search(options)
    .then(results => {
      if (results.length > 0) {
        resultsArray.push(...results);
        return getPromisesByCity(city, categoryIndex, offset + 120, resultsArray);
      } else if (results.length == 0 && categoryIndex < categories.length - 1) {
        return getPromisesByCity(city, categoryIndex + 1, offset + 120, resultsArray);
      }
      return resultsArray;
    })
    .catch(err => {
      console.log(`error for city name '${options.city}'`);
    });
}

function getPromiseHashByCity() {
  const promises = {};
  _.each(subdomains, (info, subdomain) => {
    promises[subdomain] = getPromisesByCity(subdomain, 0, 0, []);
  });
  return promises;
}

function getAllPostingsByCity() {
  const promiseHashByCity = getPromiseHashByCity();

  return rsvp.hashSettled(promiseHashByCity);
}

function indexEsDocuments(esDocs) {
  esClient.indices.delete({ index: 'listings' }, (err, res) => {
    if (!err) {
      const mappingsAndSettings = JSON.parse(fs.readFileSync('./listings.json', 'utf-8'));
      esClient.indices.create({ index: 'listings', body: mappingsAndSettings }, (err, res) => {
        if (!err) {
          const bulkOptions = {
            body: esDocs,
            refresh: 'true'
          };
          esClient.bulk(bulkOptions, (err, res) => {
            console.log('Done');
          });
        }
      });
    }
  });
}

function fetchAndIndexPostings() {
  const esDocs = [];
  getAllPostingsByCity()
    .then(postingsBySubdomain => {
      _.each(postingsBySubdomain, (postings, subdomain) => {
        if (postings.state === 'fulfilled' && postings.value !== undefined && !_.isEmpty(postings.value)) {
          const { city, location } = subdomains[subdomain];
          _.each(postings.value, posting => {
            const esDocument = {
              city,
              location,
              price: parseInt(posting.price.slice(1)),
              subdomain,
              title: decodeAsciiApostrophes(posting.title),
              url: posting.url
            };
            // console.log(`queueing document: subdomain '${esDocument.subdomain}', title '${esDocument.title}'`);
            esDocs.push({ index:  { _index: 'listings', _type: '_doc'} });
            esDocs.push(esDocument);
          });
        }
      });
      console.log('Indexing documents...');
      indexEsDocuments(esDocs);
    });
}

fetchAndIndexPostings()

// tests
