'use strict';

var assert = require('chai').assert;
var NGram = require('../src/ngram');
var n = 2;

describe('n-gram sketch', function() {
  var str1 = 'aBabcdefghij';
  var str2 = 'bcbcefhikln';

  it('should count n-grams', function() {
    var ng = new NGram();
    assert.equal(ng._n, 2);
    assert.equal(ng._case, false);

    ng.add(str1);
    assert.equal(ng.query('ab'), 2);
    assert.equal(ng.query('AB'), 2);
    assert.equal(ng.query('aB'), 2);
    assert.equal(ng.query('ba'), 1);
    assert.equal(ng.query('Ba'), 1);
    assert.equal(ng.query('bA'), 1);
    assert.equal(ng.query('ij'), 1);
    assert.equal(ng.query('jk'), 0);
    assert.equal(ng.size(), 10);
    assert.equal(ng.norm(), Math.sqrt(13));

    ng.add(str2);
    ng.add(null);
    ng.add('');
    assert.equal(ng.query('bc'), 3);
    assert.equal(ng.query('ef'), 2);
    assert.equal(ng.query('hi'), 2);
    assert.equal(ng.query('ij'), 1);
  });

  it('should respect case sensitivity', function() {
    var ng = new NGram(2, true);

    ng.add(str1);
    assert.equal(ng.query('ab'), 1);
    assert.equal(ng.query('AB'), 0);
    assert.equal(ng.query('aB'), 1);
    assert.equal(ng.query('ba'), 0);
    assert.equal(ng.query('Ba'), 1);
    assert.equal(ng.query('bA'), 0);
    assert.equal(ng.query('ij'), 1);
    assert.equal(ng.query('jk'), 0);
    assert.equal(ng.size(), 11);
    assert.equal(ng.norm(), Math.sqrt(11));
    assert.equal(ng.norm(), Math.sqrt(11)); // repeat to hit cache
  });

  it('should compute dot product', function() {
    var ng1 = new NGram(2); ng1.add(str1);
    var ng2 = new NGram(2); ng2.add(str2);
    assert.equal(ng1.dot(ng2), 4);
    assert.equal(ng1.cosine(ng2), 4 / (Math.sqrt(13) * Math.sqrt(12)));
    assert.equal(ng1.cosine(new NGram()), 0);
  });

  it('should serialize and deserialize', function() {
    var ng1 = new NGram(2); ng1.add(str1);
    var json = JSON.stringify(ng1.export());
    var ng2 = NGram.import(JSON.parse(json));
    assert.deepEqual(ng1.export(), ng2.export());
  });

});
