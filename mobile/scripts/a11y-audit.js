// Fails when the mobile app has tappable elements screen readers cannot identify:
// Pressable / Touchable* without an accessibilityRole (or role), and IconButton without a label.
// Usage: node mobile/scripts/a11y-audit.js [source folder, default mobile/src]
// Needs only the TypeScript compiler: from mobile/node_modules, or the folder it runs from.
const fs = require('fs')
const path = require('path')

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'src'))
const ts = require(require.resolve('typescript', { paths: [path.join(__dirname, '..'), process.cwd()] }))

const TAPPABLE = /^(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)$/
const files = []
;(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    if (fs.statSync(file).isDirectory()) walk(file)
    else if (file.endsWith('.tsx')) files.push(file)
  }
})(root)

const problems = []
for (const file of files) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const visit = (node) => {
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
      const tag = node.tagName.getText(source)
      const props = node.attributes.properties
      const names = new Set(props.filter(ts.isJsxAttribute).map((a) => a.name.getText(source)))
      const spread = props.some(ts.isJsxSpreadAttribute)
      const where = `${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
      if (TAPPABLE.test(tag) && !spread && !names.has('accessibilityRole') && !names.has('role')) {
        problems.push(`${where}  <${tag}> has no accessibilityRole`)
      }
      if (tag === 'IconButton' && !names.has('label')) problems.push(`${where}  <IconButton> has no label`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

for (const problem of problems) console.log(problem)
console.log(`${problems.length} accessibility problem(s) in ${files.length} files`)
process.exit(problems.length ? 1 : 0)
