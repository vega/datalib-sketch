'use strict';

var assert = require('chai').assert;
var Bloom = require('../src/bloom');
var EPSILON = 0.1;
var width = 1024;
var depth = 1;

describe('bloom filter', function() {
  var set1 = 'abcdefghij'.split('');
  var set2 = 'klmnopqrst'.split('');
  var set3 = '123456789\u2022'.split('');

  function hitcount(bf) {
    return function(count, d) {
      return bf.query(d) ? count+1 : count;
    };
  }

  it('should support constructors', function() {
    var n = 100,
        p = 0.01,
        w = -n * Math.log(p) / (Math.LN2 * Math.LN2),
        d = (w / n) * Math.LN2;

    var bf1 = Bloom.create(n, p);
    var bf2 = new Bloom(~~w, ~~d);
    assert.equal(bf1._w, bf2._w);
    assert.equal(bf1._d, bf2._d);

    bf1 = new Bloom();
    assert.isAbove(bf1._w, 0);
    assert.isAbove(bf1._d, 0);
  });

  it('should approximately model set membership', function() {
    var bf = new Bloom(width, depth);
    set1.forEach(function(d) { bf.add(d); });
    assert.closeTo(10, bf.size(), 10*EPSILON);
    
    var hits = set1.reduce(hitcount(bf), 0);
    assert.closeTo(10, hits, 10*EPSILON);

    var miss = set2.reduce(hitcount(bf), 0);    
    assert.closeTo(0, miss, 10*EPSILON);

    miss = set3.reduce(hitcount(bf), 0);    
    assert.closeTo(0, miss, 10*EPSILON);
  });

  it('should support union', function() {
    var bf1 = new Bloom(width, depth);
    var bf2 = new Bloom(width, depth);
    set1.forEach(function(d) { bf1.add(d); });
    set2.forEach(function(d) { bf2.add(d); });

    var bfu = bf1.union(bf2);
    assert.closeTo(20, bfu.size(), 20*EPSILON);
    
    var hits = set1.reduce(hitcount(bfu), 0);
    hits += set2.reduce(hitcount(bfu), 0);
    assert.closeTo(20, hits, 20*EPSILON);

    var miss = set3.reduce(hitcount(bfu), 0);    
    assert.closeTo(0, miss, 20*EPSILON);

    assert.throws(function() { bf1.union(new Bloom(width+1, depth)); });
    assert.throws(function() { bf1.union(new Bloom(width, depth+1)); });
  });

  it('should estimate jaccard coefficient', function() {
    var bf1 = new Bloom(width, depth);
    var bf2 = new Bloom(width, depth);
    assert.equal(bf1.jaccard(bf2), 0);

    set1.forEach(function(d) { bf1.add(d); });
    set2.forEach(function(d) { bf2.add(d); });
    assert.closeTo(0, bf1.jaccard(bf2), EPSILON);
    assert.closeTo(1, bf1.jaccard(bf1), EPSILON);
    assert.closeTo(1, bf2.jaccard(bf2), EPSILON);
    
    var bfu = bf1.union(bf2);
    assert.closeTo(0.5, bfu.jaccard(bf1), EPSILON);
    assert.closeTo(0.5, bfu.jaccard(bf2), EPSILON);

    assert.throws(function() { bf1.jaccard(new Bloom(width+1, depth)); });
    assert.throws(function() { bf1.jaccard(new Bloom(width, depth+1)); });
  });

  it('should estimate set cover', function() {
    var bf1 = new Bloom(width, depth);
    var bf2 = new Bloom(width, depth);
    assert.equal(bf1.cover(bf2), 0);

    set1.forEach(function(d) { bf1.add(d); });
    set2.forEach(function(d) { bf2.add(d); });
    assert.closeTo(0, bf1.cover(bf2), EPSILON);
    assert.closeTo(1, bf1.cover(bf1), EPSILON);
    assert.closeTo(1, bf2.cover(bf2), EPSILON);
    
    var bfu = bf1.union(bf2);
    assert.closeTo(1.0, bfu.cover(bf1), EPSILON);
    assert.closeTo(1.0, bfu.cover(bf2), EPSILON);

    assert.throws(function() { bf1.cover(new Bloom(width+1, depth)); });
    assert.throws(function() { bf1.cover(new Bloom(width, depth+1)); });
  });

  it('should serialize and deserialize', function() {
    var bf1 = new Bloom(width, depth);
    set1.forEach(function(d) { bf1.add(d); });
    var json = JSON.stringify(bf1.export());
    var bf2 = Bloom.import(JSON.parse(json));
    assert.deepEqual(bf1.export(), bf2.export());
  });
});
