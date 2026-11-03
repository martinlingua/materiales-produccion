// Cosas del navegador que Chrome 49 (Windows XP) no trae y core-js no cubre.
import 'abortcontroller-polyfill/dist/polyfill-patch-fetch';

// Element.append / prepend (Chrome < 54)
[Element.prototype, Document.prototype, DocumentFragment.prototype].forEach(function (p) {
  if (!p.append) p.append = function () {
    for (var i = 0; i < arguments.length; i++) {
      var n = arguments[i];
      this.appendChild(n instanceof Node ? n : document.createTextNode(String(n)));
    }
  };
  if (!p.prepend) p.prepend = function () {
    var primero = this.firstChild;
    for (var i = 0; i < arguments.length; i++) {
      var n = arguments[i];
      this.insertBefore(n instanceof Node ? n : document.createTextNode(String(n)), primero);
    }
  };
});

// Blob.text() / arrayBuffer() (Chrome < 76)
function leer(blob, metodo) {
  return new Promise(function (ok, mal) {
    var r = new FileReader();
    r.onload = function () { ok(r.result); };
    r.onerror = function () { mal(r.error); };
    r[metodo](blob);
  });
}
if (!Blob.prototype.text) Blob.prototype.text = function () { return leer(this, 'readAsText'); };
if (!Blob.prototype.arrayBuffer) Blob.prototype.arrayBuffer = function () { return leer(this, 'readAsArrayBuffer'); };

if (!Element.prototype.remove) Element.prototype.remove = function () { if (this.parentNode) this.parentNode.removeChild(this); };
