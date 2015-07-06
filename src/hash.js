var arrays = require('./arrays');

// Fowler/Noll/Vo hashing.
function fnv_1a(v) {
  var a = 2166136261;
  for (var i = 0, n = v.length; i < n; ++i) {
    var c = v.charCodeAt(i),
        d = c & 0xff00;
    if (d) a = fnv_multiply(a ^ d >> 8);
    a = fnv_multiply(a ^ c & 0xff);
  }
  return fnv_mix(a);
}

// a * 16777619 mod 2**32
function fnv_multiply(a) {
  return a + (a << 1) + (a << 4) + (a << 7) + (a << 8) + (a << 24);
}

// One additional iteration of FNV, given a hash.
function fnv_1a_b(a) {
  return fnv_mix(fnv_multiply(a));
}

// See https://web.archive.org/web/20131019013225/http://home.comcast.net/~bretm/hash/6.html
function fnv_mix(a) {
  a += a << 13;
  a ^= a >>> 7;
  a += a << 3;
  a ^= a >>> 17;
  a += a << 5;
  return a & 0xffffffff;
}

// mix-in method for multi-hash initialization
module.exports.init = function() {
  this._locations = arrays.ints(this._d);
};

// mix-in method for multi-hash calculation
// See http://willwhim.wordpress.com/2011/09/03/producing-n-hash-functions-by-hashing-only-once/
module.exports.locations = function(v) {
  var d = this._d,
      w = this._w,
      r = this._locations,
      a = fnv_1a(v),
      b = fnv_1a_b(a),
      i = -1,
      x = a % w;
  while (++i < d) {
    r[i] = x < 0 ? (x + w) : x;
    x = (x + b) % w;
  }
  return r;
};

module.exports.fnv_1a = fnv_1a;
module.exports.fnv_1a_b = fnv_1a_b;
