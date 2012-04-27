var assert = require('assert');

assert.equal("""""", '');
assert.equal("""\""", '\\');
assert.equal("""\\""", '\\');
assert.equal(""" " """, ' " ');
assert.equal(""" \" """, ' \\" ');
assert.equal(""" \\" """, ' \\" ');
assert.equal("""

""", '\n\n');
