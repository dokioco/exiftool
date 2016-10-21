import { compact } from '../datetime'
import { exiftool } from '../exiftool'
import * as process from 'process'
import * as _fs from 'fs'
import * as _path from 'path'

// THIS IS SAUSAGECODE. JUDGE ME NOT BY MY SAUSAGE. 

// ☠☠ SCROLL DOWN AT YOUR OWN PERIL ☠☠

const globule = require('globule')

function ellipsize(str: string, max: number) {
  str = '' + str
  return (str.length < max) ? str : str.substring(0, max - 1) + '…'
}

function usage() {
  console.log('Usage: `npm run mktags IMG_DIR`')
  console.log('\nRebuilds src/tags.ts from tags found in IMG_DIR.')
  process.exit(1)
}

const root = process.argv[2]
const files: string[] = globule.find(`${root}/**/*.jpg`)

if (files.length === 0) {
  console.error(`No files found in ${root}`)
  usage()
}

function valueType(value: any): string {
  if (typeof value === 'object') {
    const ctorName = value.constructor.name
    if (ctorName === 'Array') {
      if (value.length === 0) {
        return 'any[]'
      } else {
        return `${valueType(value[0])}[]`
      }
    } else {
      return ctorName
    }
  } else {
    return typeof value
  }
}

class Tag {
  values: any[] = []
  important: boolean
  constructor(readonly tag: string) {
  } // tslint:disable-line

  get group(): string { return this.tag.split(':')[0] }
  get withoutGroup(): string { return this.tag.split(':')[1] }
  get valueType(): string {
    return valueType(this.firstValue())
  }
  keep(minValues: number): boolean {
    return this.firstValue() !== undefined && this.important || this.values.length >= minValues
  }
  popIcon(totalValues: number): string {
    const f = this.values.length / totalValues
    const stars = (f > .75) ? '★★★' : (f > .5) ? '★★☆' : (f > .25) ? '★☆☆' : '☆☆☆'
    const important = (this.important) ? '✔' : ' '
    return `${stars} ${important}`
  }
  firstValue(): any {
    return compact(this.values)[0]
  }
  example(): string {
    return ellipsize(JSON.stringify(this.firstValue()), 80)
  }
}

type GroupedTags = { [groupName: string]: Tag[] }

class TagMap {
  readonly map = new Map<string, Tag>()
  private maxValueCount = 0

  tag(tag: string) {
    const prevTag = this.map.get(tag)
    if (prevTag) {
      return prevTag
    } else {
      const t = new Tag(tag)
      this.map.set(tag, t)
      return t
    }
  }
  add(tagName: string, value: any, important: boolean) {
    const tag = this.tag(tagName)
    if (important) { tag.important = true }
    const values = tag.values
    values.push(value)
    this.maxValueCount = Math.max(values.length, this.maxValueCount)
  }
  tags(): Tag[] {
    const minValues = this.maxValueCount * .005
    const allTags = Array.from(this.map.values())
    console.log(`Skipping the following tags due to < ${minValues.toFixed(0)} occurances:`)
    console.log(allTags.filter(a => !a.keep(minValues)).map(t => t.tag).join(', '))
    return allTags.filter(a => a.keep(minValues))
  }
  groupedTags(): GroupedTags {
    const groupedTags: GroupedTags = {}
    this.tags().forEach(tag => {
      const key = tag.group;
      (groupedTags[key] || (groupedTags[key] = [])).push(tag)
    })
    return groupedTags
  }
}

function cmp(a: any, b: any): number {
  return a > b ? 1 : a < b ? -1 : 0
}

const tagMap = new TagMap()

const saneTagRe = /^[a-z0-9_]+:[a-z0-9_]+$/i

const start = Date.now()
Promise.all(files.map(file => {
  return exiftool.readGrouped(file).then((metadata: any) => {
    const importantFile = file.toString().toLowerCase().includes('important')
    Object.keys(metadata).forEach(key => {
      if (saneTagRe.exec(key)) { tagMap.add(key, metadata[key], importantFile) }
    })
    process.stdout.write('.')
  }).catch(err => console.log(err))
})).then(() => {
  console.log(`\nRead ${tagMap.map.size} unique tags from ${files.length} files. `)
  const elapsedMs = Date.now() - start
  console.log(`Parsing took ${elapsedMs}ms (${(elapsedMs / files.length).toFixed(1)}ms / file)`)
  const destFile = _path.resolve(__dirname, '../../src/tags.ts')
  const tagWriter = _fs.createWriteStream(destFile)
  tagWriter.write('/* tslint:disable:class-name */\n') // because of ICC_Profile
  tagWriter.write(`import { ExifDate, ExifTime, ExifDateTime } from './datetime'\n\n`)
  tagWriter.write(`// Autogenerated by "npm run mktags" on ${new Date().toDateString()}.\n\n`)
  tagWriter.write('// Comments by each tag include popularity (★★★ is > 70% of cameras, ☆☆☆ is rare),\n')
  tagWriter.write('// followed by a checkmark if the tag is used by recent, popular devices (like iPhones)\n')
  tagWriter.write('// An example value, JSON stringified, follows the popularity ratings.\n')
  const groupedTags = tagMap.groupedTags()
  const groupTagNames: string[] = []
  for (const group in groupedTags) {
    groupTagNames.push(group)
    tagWriter.write(`\nexport interface ${group}Tags {\n`)
    const tags = groupedTags[group].sort((a, b) => cmp(a.tag, b.tag))
    tags.forEach(tag => {
      tagWriter.write(`  /** ${tag.popIcon(files.length)} ${tag.example()} */\n`)
      tagWriter.write(`  ${tag.withoutGroup}: ${tag.valueType}\n`)
    })
    tagWriter.write(`}\n`)
  }
  tagWriter.write('\n')
  tagWriter.write('export interface Tags extends\n')
  tagWriter.write(`  ${groupTagNames.map(s => s + 'Tags').join(',\n  ')} {\n`)
  tagWriter.write('  SourceFile: string\n')
  tagWriter.write('  warnings: string[]\n')
  tagWriter.write('}\n')
  tagWriter.write('\n')
  tagWriter.write('export interface GroupedTags {\n')
  tagWriter.write('  SourceFile: string\n')
  tagWriter.write('  warnings: string[]\n')
  for (const group of groupTagNames) {
    tagWriter.write(`  ${group}: ${group}Tags\n`)
  }
  tagWriter.write('}\n')
  tagWriter.end()
}).catch(err => {
  console.log(err)
}).then(() => {
  exiftool.end()
})
