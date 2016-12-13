# datalib-sketch

[![Build Status](https://travis-ci.org/vega/datalib-sketch.svg?branch=master)](https://travis-ci.org/vega/datalib-sketch)
[![npm version](https://img.shields.io/npm/v/datalib-sketch.svg)](https://www.npmjs.com/package/datalib-sketch)

Probabilistic data structures for large or streaming data sets.

This module exports the following sketches:

- **[Bloom](https://github.com/vega/datalib-sketch/blob/master/src/bloom.js)** - [Bloom filters](http://en.wikipedia.org/wiki/Bloom_filter) test for (approximate) set membership.
- **[CountMin](https://github.com/vega/datalib-sketch/blob/master/src/count-min.js)** - [Count-min sketches](https://en.wikipedia.org/wiki/Count%E2%80%93min_sketch) estimate frequency counts for streaming values.
- **[CountMinMean](https://github.com/vega/datalib-sketch/blob/master/src/count-mean-min.js)** - Count-min-mean sketches modify the estimates of count-min sketches to account for bias.
- **[NGram](https://github.com/vega/datalib-sketch/blob/master/src/ngram.js)** - The N-Gram sketch simply counts all n-character strings (default 2) in text data.
- **[StreamSummary](https://github.com/vega/datalib-sketch/blob/master/src/stream-summary.js)** - The [StreamSummary sketch](https://scholar.google.com/scholar?cluster=19290737159395554) tracks top-k frequent values.
- **[TDigest](https://github.com/vega/datalib-sketch/blob/master/src/t-digest.js)** - The [T-digest](https://github.com/tdunning/t-digest) estimates a variable-width histogram for quantile and cdf estimation.

## Build Process

To use datalib-sketch in the browser, you need to build the datalib-sketch.js and datalib-sketch.min.js files. We assume that you have [npm](https://www.npmjs.com/) installed.

1. Run `npm install` in the datalib-sketch folder to install dependencies.
2. Run `npm run build`. This will invoke [browserify](http://browserify.org/) to bundle the source files into datalib-sketch.js, and then [uglify-js](http://lisperator.net/uglifyjs/) to create the minified datalib-sketch.min.js.
