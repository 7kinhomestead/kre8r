'use strict';
const fs = require('fs');

const html    = fs.readFileSync('C:/Users/18054/kre8r/public/analytr.html');

// The broken pattern is: buffer.split(' + 0x0a (LF) + ');
// It needs to be:        buffer.split('\n');  i.e. buffer.split( + ' + backslash + n + ' + )
const brokenHex = '6275666665722e73706c697428270a27293b'; // buffer.split('<LF>');
const fixedHex  = '6275666665722e73706c69742827' + '5c6e' + '27293b'; // buffer.split('\n');

const broken = Buffer.from(brokenHex, 'hex');
const fixed  = Buffer.from(fixedHex,  'hex');

console.log('Broken pattern:', JSON.stringify(broken.toString('utf8')));
console.log('Fixed  pattern:', JSON.stringify(fixed.toString('utf8')));

const idx = html.indexOf(broken);
if (idx === -1) {
  console.log('Pattern not found — may already be fixed');
  process.exit(0);
}

console.log('Found at byte offset:', idx);
const result = Buffer.concat([html.slice(0, idx), fixed, html.slice(idx + broken.length)]);
fs.writeFileSync('C:/Users/18054/kre8r/public/analytr.html', result);
console.log('Fixed! Verifying...');

// Verify
const updated = fs.readFileSync('C:/Users/18054/kre8r/public/analytr.html');
const stillBroken = updated.indexOf(broken);
const nowFixed    = updated.indexOf(fixed);
console.log('Still broken at:', stillBroken, '(should be -1)');
console.log('Now fixed at:',   nowFixed,    '(should be > 0)');
