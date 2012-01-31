# Nestless.js

Rewrites synchronous-style flattened JS into callback-y JS.

Sample input:

    function cat(encoding, cb) {
        filename <- askUser("Filename? ");
        contents <- fs.readFile(filename, encoding);
        if (contents.match(/piracy/))
            throw "TAKEN DOWN";
        return contents;
    }

becomes:

    function cat(encoding, cb) {
        askUser("Filename? ", function (err, filename) { if (err) return cb(err);
        fs.readFile(filename, encoding, function (err, contents) { if (err) return cb(err);
        if (contents.match(/piracy/))
            return cb("TAKEN DOWN");
        return cb(null, contents);
    }); }); }

The transformation is braindead but it will always **preserve line numbers**.

Every transformed function must take a last parameter called `callback` or `cb` and contain at least one arrow binding.

After the first arrow binding, any `return` or `throw` in the same function *(not in contained functions!)* will be transformed to a callback invocation.
See the test folder for more examples.

## WARNING

* Nestless is very dumb and hacky and comes without warranty.
  It only handles a certain (common) case.
  Do not use nestless-generated code for anything important without examining the transformed output.
* Loops are right out.
  Use [async.js](https://github.com/caolan/async) or [TameJS](http://tamejs.org/).
* Once you `return` a value, nestless tries to stop all execution in the function by possibly inserting more `return`s.
  Strange control flows may break this.
  I assume no responsibility if your callback never gets called or, worse, gets called multiple times.

## Meta

Install with `npm install -g nestless`.

Many thanks to Mozilla for [Narcissus](https://github.com/mozilla/narcissus/) which parses the JavaScript and provides token boundaries for rewriting. Relevant bits of Narcissus have been patched and bundled with Nestless, and it assumes the same license.
