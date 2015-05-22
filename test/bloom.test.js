'use strict';

var assert = require('chai').assert;
var BloomFilter = require('../src/bloom');
var EPSILON = 0.1;

describe('bloom filter', function() {
  var set1 = 'abcdefghij'.split('');
  var set2 = 'klmnopqrst'.split('');
  var set3 = '0123456789'.split('');

  function hitcount(bf) {
    return function(count, d) {
      return bf.query(d) ? count+1 : count;
    };
  }

  it('should approximately model set membership', function() {
    var bf = new BloomFilter(1024, 3);
    set1.forEach(function(d) { bf.add(d); });
    assert.closeTo(10, bf.size(), 10*EPSILON);
    
    var hits = set1.reduce(hitcount(bf), 0);
    assert.closeTo(10, hits, 10*EPSILON);

    var miss = set2.reduce(hitcount(bf), 0);    
    assert.closeTo(0, miss, 10*EPSILON);

    miss = set3.reduce(hitcount(bf), 0);    
    assert.closeTo(0, miss, 10*EPSILON);
  });

  it('should union', function() {
    var bf1 = new BloomFilter(1024, 3);
    var bf2 = new BloomFilter(1024, 3);
    set1.forEach(function(d) { bf1.add(d); });
    set2.forEach(function(d) { bf2.add(d); });

    var bfu = bf1.union(bf2);
    assert.closeTo(20, bfu.size(), 20*EPSILON);
    
    var hits = set1.reduce(hitcount(bfu), 0);
    hits += set2.reduce(hitcount(bfu), 0);
    assert.closeTo(20, hits, 20*EPSILON);

    var miss = set3.reduce(hitcount(bfu), 0);    
    assert.closeTo(0, miss, 20*EPSILON);
  });

  it('should jaccard', function() {
    var bf1 = new BloomFilter(1024, 3);
    var bf2 = new BloomFilter(1024, 3);
    set1.forEach(function(d) { bf1.add(d); });
    set2.forEach(function(d) { bf2.add(d); });

    assert.closeTo(0, bf1.jaccard(bf2), EPSILON);
    assert.closeTo(1, bf1.jaccard(bf1), EPSILON);
    assert.closeTo(1, bf2.jaccard(bf2), EPSILON);
    
    var bfu = bf1.union(bf2);
    assert.closeTo(0.5, bfu.jaccard(bf1), EPSILON);
    assert.closeTo(0.5, bfu.jaccard(bf2), EPSILON);
  });

});
