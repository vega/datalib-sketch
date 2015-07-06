'use strict';

var assert = require('chai').assert;
var arrays = require('../src/arrays');
var path = process.cwd() + '/src/arrays.js';

describe('arrays', function() {
  
  it('should create typed arrays by default', function() {
    var fa = arrays.floats(5);
    var ia = arrays.ints(5);
    assert.isTrue(fa instanceof Float64Array);
    assert.isTrue(ia instanceof Int32Array);
    for (var i=0; i<5; ++i) {
      assert.equal(fa[i], 0);
      assert.equal(ia[i], 0);
    }
  });

  it('should create normal arrays as backup', function() {
    var saved = ArrayBuffer;
    ArrayBuffer = undefined;
    delete require.cache[path];

    var fa = require(path).floats(5);
    var ia = require(path).ints(5);
    assert.isTrue(fa instanceof Array);
    assert.isTrue(ia instanceof Array);
    for (var i=0; i<5; ++i) {
      assert.equal(fa[i], 0);
      assert.equal(ia[i], 0);
    }

    ArrayBuffer = saved;
    delete require.cache[path];
  });
});
