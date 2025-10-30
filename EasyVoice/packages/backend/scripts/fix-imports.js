// scripts/fix-all-imports.js
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname, dirname, resolve, relative } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const distDir = resolve(__dirname, '..', 'dist')

function processDirectory(dir) {
  if (!existsSync(dir)) return

  const files = readdirSync(dir)
  
  for (const file of files) {
    const fullPath = join(dir, file)
    const stat = statSync(fullPath)
    
    if (stat.isDirectory()) {
      processDirectory(fullPath)
    } else if (extname(file) === '.js') {
      console.log(`Processing file: ${fullPath}`);
      fixAllImportTypes(fullPath)
    }
  }
}

function fixAllImportTypes(filePath) {
  try {
    let content = readFileSync(filePath, 'utf8')
    let modified = false
    
    console.log(`Checking imports in: ${filePath}`);
    
    // 匹配所有形式的导入语句
    const importPatterns = [
      // import { x } from './module'
      /(import\s+(?:\{[^}]+\}|\w+)\s+from\s+['"])([^'"]+)(['"])/g,
      // import * as x from './module'
      /(import\s+\*\s+as\s+\w+\s+from\s+['"])([^'"]+)(['"])/g,
      // import x from './module'
      /(import\s+\w+\s+from\s+['"])([^'"]+)(['"])/g,
      // import './module'
      /(import\s+['"])([^'"]+)(['"])/g,
      // export { x } from './module'
      /(export\s+\{[^}]+\}\s+from\s+['"])([^'"]+)(['"])/g,
      // export * from './module'
      /(export\s+\*\s+from\s+['"])([^'"]+)(['"])/g,
      // export * as x from './module'
      /(export\s+\*\s+as\s+\w+\s+from\s+['"])([^'"]+)(['"])/g
    ]
    
    importPatterns.forEach((pattern, index) => {
      content = content.replace(pattern, (match, prefix, importPath, suffix) => {
        console.log(`Pattern ${index} matched: ${match}`);
        
        // 只处理相对路径
        if (!importPath.startsWith('./') && !importPath.startsWith('../') && importPath !== '.' && importPath !== '..') {
          console.log(`Skipping non-relative path: ${importPath}`);
          return match
        }
        
        // 跳过已经有.js扩展名的导入
        if (importPath.endsWith('.js')) {
          console.log(`Skipping path with .js extension: ${importPath}`);
          return match;
        }
        
        console.log(`Processing import in ${relative(distDir, filePath)}: ${importPath}`);
        
        const newImportPath = resolveImportWithExtension(filePath, importPath)
        
        if (newImportPath !== importPath) {
          modified = true
          console.log(`Fixed: ${importPath} -> ${newImportPath} in ${relative(distDir, filePath)}`)
          return prefix + newImportPath + suffix
        }
        
        return match
      })
    })
    
    if (modified) {
      console.log(`Writing modified file: ${filePath}`);
      writeFileSync(filePath, content, 'utf8')
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message)
  }
}

function resolveImportWithExtension(currentFile, importPath) {
  console.log(`Resolving import path: ${importPath}`);
  
  const currentDir = dirname(currentFile)
  
  // 解析导入路径
  let absolutePath
  if (importPath === '.') {
    absolutePath = currentDir
  } else if (importPath === '..') {
    absolutePath = dirname(currentDir)
  } else {
    absolutePath = join(currentDir, importPath)
  }
  
  console.log(`Absolute path: ${absolutePath}`);
  
  // 情况1: 检查是否是目录
  if (existsSync(absolutePath) && statSync(absolutePath).isDirectory()) {
    const indexPath = join(absolutePath, 'index.js')
    if (existsSync(indexPath)) {
      console.log(`Matched directory with index.js`);
      return formatPath(importPath, '/index.js')
    }
  }
  
  // 情况2: 检查是否有对应的.js文件
  const jsPath = absolutePath + '.js'
  console.log(`Checking .js path: ${jsPath}, exists: ${existsSync(jsPath)}`);
  if (existsSync(jsPath)) {
    console.log(`Matched direct .js file`);
    return formatPath(importPath, '.js')
  }
  
  // 情况3: 检查是否直接指向一个文件（没有扩展名）
  if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
    console.log(`Matched existing file without extension`);
    return formatPath(importPath, '.js')
  }
  
  // 情况4: 检查是否有对应的.ts文件（源文件）
  const tsPath = absolutePath + '.ts'
  if (existsSync(tsPath)) {
    console.log(`Matched .ts source file`);
    return formatPath(importPath, '.js')
  }
  
  // 情况5: 检查是否有不带扩展名但实际存在的文件（例如 error.middleware -> error.middleware.js）
  const dir = dirname(absolutePath)
  const baseName = importPath.split('/').pop() // 获取文件名部分
  console.log(`Dir: ${dir}, Base name: ${baseName}`);
  if (existsSync(dir) && statSync(dir).isDirectory()) {
    const files = readdirSync(dir)
    console.log(`Files in directory: ${files.join(', ')}`);
    for (const file of files) {
      // 如果文件名以导入路径开头，并且以 .js 结尾
      if (file.startsWith(baseName + '.') && file.endsWith('.js') && statSync(join(dir, file)).isFile()) {
        // 构造正确的相对路径
        const dirPath = importPath.split('/').slice(0, -1).join('/')
        const finalPath = dirPath ? dirPath + '/' + file : './' + file
        // 检查是否已经有 .js 扩展名，避免重复添加
        if (!finalPath.endsWith('.js')) {
          console.log(`Matched file with dots: ${file}, returning ${finalPath}`);
          return finalPath + '.js';
        }
        console.log(`Matched file with dots: ${file}, returning ${finalPath}`);
        return finalPath;
      }
      
      // 特殊情况：如果文件名完全匹配（但没有扩展名）
      if (file === baseName + '.js' && statSync(join(dir, file)).isFile()) {
        console.log(`Matched exact file: ${file}`);
        return importPath + '.js'
      }
    }
  }
  
  // 如果以上情况都不匹配，尝试直接添加 .js 扩展名
  // 这是针对 error.middleware 这样的情况，实际文件就是 error.middleware.js
  const directJsPath = absolutePath + '.js';
  console.log(`Checking direct .js path: ${directJsPath}, exists: ${existsSync(directJsPath)}`);
  if (existsSync(directJsPath) && statSync(directJsPath).isFile()) {
    console.log(`Matched final fallback`);
    // 避免重复添加 .js 扩展名
    if (!importPath.endsWith('.js')) {
      return importPath + '.js';
    }
    return importPath;
  }
  
  // 无法解析
  console.log(`No match found for: ${importPath}`);
  return importPath
}

function formatPath(originalPath, extension) {
  if (originalPath === '.') {
    return '.' + extension
  } else if (originalPath === '..') {
    return '..' + extension
  } else {
    return originalPath + extension
  }
}

if (existsSync(distDir)) {
  console.log(`Fixing all imports in: ${distDir}`)
  processDirectory(distDir)
  console.log('All imports fixed!')
} else {
  console.error('Dist directory not found:', distDir)
  process.exit(1)
}