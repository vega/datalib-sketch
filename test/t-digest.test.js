'use strict';

var assert = require('chai').assert;
var dl = require('datalib');
var TDigest = require('../src/t-digest');
var EPS = 0.05;

describe('t-digest', function() {

  var U = dl.range(0, 1.1, 0.1);
  var N = [0.1, 0.25, 0.5, 0.75, 0.9];
  var NQ = [-1.28155, -0.67449, 0, 0.67449, 1.28155];
  
  var US = dl.random.uniform(0, 1).samples(10000);
  var NS = dl.random.normal(0, 1).samples(10000);

  it('should calculate quantile estimates', function() {
    var td, add = function(x) { td.add(x); };

    // check estimates for uniform distribution
    td = new TDigest();
    US.forEach(add);
    U.forEach(function(q) { assert.closeTo(td.quantile(q), q, EPS); });

    // check estimates for normal distribution
    td = new TDigest();
    NS.forEach(add);
    N.forEach(function(q,i) { assert.closeTo(td.quantile(q), NQ[i], EPS); });
  });

  it('should calculate cdf estimates', function() {
    var td, add = function(x) { td.add(x); };

    // check estimates for uniform distribution
    td = new TDigest();
    US.forEach(add);
    U.forEach(function(q) { assert.closeTo(td.cdf(q), q, EPS); });

    // check estimates for normal distribution
    td = new TDigest();
    NS.forEach(add);
    NQ.forEach(function(q,i) { assert.closeTo(td.cdf(q), N[i], EPS); });
  });

  it('should make monotonic estimates', function() {
    var td, add = function(x) { td.add(x); };

    // check estimates for normal distribution
    td = new TDigest();
    US.forEach(add);
    var prevC = td.cdf(0),
        prevQ = td.quantile(0),
        currC, currQ;
    for (var x=0.01; x<=1; x+=0.01, prevC = currC, prevQ = currQ) {
      assert.isTrue((currC = td.cdf(x)) >= prevC);
      assert.isTrue((currQ = td.quantile(x)) >= prevQ);
    }
  });

  it('should serialize and deserialize', function() {
    var td1 = new TDigest();
    NS.forEach(function(x) { td1.add(x); });
    var json = JSON.stringify(td1.export());
    var td2 = TDigest.import(JSON.parse(json));
    assert.deepEqual(td1.export(), td2.export());
  });

});
