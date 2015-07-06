var TYPED_ARRAYS = typeof ArrayBuffer !== 'undefined';

function floats(n) {
  return new Float64Array(n);
}

function ints(n) {
  return new Int32Array(n);
}

function array(n) {
  var a = Array(n);
  for (var i=0; i<n; ++i) a[i] = 0;
  return a;
}

module.exports = {
  floats: TYPED_ARRAYS ? floats : array,
  ints: TYPED_ARRAYS ? ints : array
};
