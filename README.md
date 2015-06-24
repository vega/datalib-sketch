# datalib-sketch

[![Build Status](https://travis-ci.org/vega/datalib-sketch.svg?branch=master)](https://travis-ci.org/vega/datalib-sketch)
[![npm version](https://img.shields.io/npm/v/datalib-sketch.svg)](https://www.npmjs.com/package/datalib-sketch)

Probabilistic data structures for large or streaming data sets.

## Build Process

To use datalib-sketch in the browser, you need to build the datalib-sketch.js and datalib-sketch.min.js files. We assume that you have [npm](https://www.npmjs.com/) installed.

1. Run `npm install` in the datalib-sketch folder to install dependencies.
2. Run `npm run build`. This will invoke [browserify](http://browserify.org/) to bundle the source files into datalib-sketch.js, and then [uglify-js](http://lisperator.net/uglifyjs/) to create the minified datalib-sketch.min.js.
