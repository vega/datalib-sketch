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

  it('should ignore invalid inputs', function() {
    var td = new TDigest();
    td.add(null);
    assert.equal(td.size(), 0);
    td.add(undefined);
    assert.equal(td.size(), 0);
    td.add(NaN);
    assert.equal(td.size(), 0);
  });

  it('should handle singular input', function() {
    var td = new TDigest();
    td.add(1);

    assert.equal(td.quantile(0.0), 1);
    assert.equal(td.quantile(0.5), 1);
    assert.equal(td.quantile(1.0), 1);

    assert.equal(td.cdf(0), 0.0);
    assert.equal(td.cdf(1), 0.5);
    assert.equal(td.cdf(2), 1.0);
    
    assert.throws(function() { new TDigest().add(1, -1); });
  });

  it('should calculate quantile estimates', function() {
    var td, add = function(x) { td.add(x); };

    // check estimates for uniform distribution
    td = new TDigest();
    US.forEach(add);
    U.forEach(function(q) { assert.closeTo(td.quantile(q), q, EPS); });
    assert.closeTo(td.quantile(0.00001), 0.00001, EPS);
    assert.closeTo(td.quantile(0.99999), 0.99999, EPS);
    assert.equal(td.size(), US.length);

    // check estimates for normal distribution
    td = new TDigest();
    NS.forEach(add);
    N.forEach(function(q,i) { assert.closeTo(td.quantile(q), NQ[i], EPS); });
    assert.equal(td.size(), NS.length);
    
    // empty digest should return NaN
    assert.isTrue(isNaN(new TDigest().quantile(0.5)));
  });

  it('should calculate cdf estimates', function() {
    var td, add = function(x) { td.add(x); };

    // check estimates for uniform distribution
    td = new TDigest();
    US.forEach(add);
    U.forEach(function(q) { assert.closeTo(td.cdf(q), q, EPS); });
    assert.closeTo(td.cdf(0.00001), 0.00001, EPS);
    assert.closeTo(td.cdf(0.99999), 0.99999, EPS);
    assert.closeTo(td.cdf(-1), 0.0, EPS);
    assert.closeTo(td.cdf(5), 1.0, EPS);
    assert.closeTo(td.cdf(td._max-1e-5), 1.0, EPS);
    assert.closeTo(td.cdf(td._mean[0]+1e-5), td.cdf(td._mean[0]), EPS);

    // check estimates for normal distribution
    td = new TDigest();
    NS.forEach(add);
    NQ.forEach(function(q,i) { assert.closeTo(td.cdf(q), N[i], EPS); });

    // empty digest should return NaN
    assert.isTrue(isNaN(new TDigest().cdf(0.5)));
  });

  it('should make monotonic estimates', function() {
    var add = function(x) { td.add(x); },
        td = new TDigest();

    // check estimates for normal distribution
    NS.forEach(add);
    var prevC = td.cdf(0),
        prevQ = td.quantile(0),
        currC, currQ;
    for (var x=0.01; x<=1; x+=0.01, prevC = currC, prevQ = currQ) {
      currC = td.cdf(x);
      currQ = td.quantile(x);
      assert.isTrue(currC >= prevC, currC + ' > ' + prevC);
      assert.isTrue(currQ >= prevQ, currQ + ' > ' + prevQ);
    }
  });

  it('should union two t-digests', function() {
    var td1 = new TDigest(),
        td2 = new TDigest(),
        n = 10000, h = n/2, i = 0;
    for (; i<=h; ++i) { td2.add(i/n); }
    for (; i<=n; ++i) { td1.add(i/n); }
    
    var td = td1.union(td2);
    for (var x=0; x<=1; x+=0.01) {
      assert.closeTo(td.quantile(x), x, EPS);
      assert.closeTo(td.cdf(x), x, EPS);
    }
  });

  it('should serialize and deserialize', function() {
    var td1 = new TDigest();
    NS.forEach(function(x) { td1.add(x); });
    var json = JSON.stringify(td1.export());
    var td2 = TDigest.import(JSON.parse(json));
    assert.equal(td2.size(), NS.length);
    assert.deepEqual(td1.export(), td2.export());
  });

});
