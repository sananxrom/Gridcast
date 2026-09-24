const ts = require('typescript'), fs = require('fs'), path = require('path');
const cache = {};
module.exports = function load(name) {
 const file = path.resolve(__dirname, '../lib', name.replace(/\.ts$/, '') + '.ts');
 if (cache[file]) return cache[file].exports;
 const mod = { exports: {} }; cache[file] = mod;
 const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(dependency=>dependency.startsWith('.') ? module.exports(path.join(path.dirname(name),dependency)) : require(dependency),mod,mod.exports);
 return mod.exports;
};
