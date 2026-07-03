import { describe, expect, test } from 'vitest'
import { inferMimeType } from '../../src/core/agent-hub/hub-client.js'

describe('inferMimeType', () => {
  test('常见文本类型', () => {
    expect(inferMimeType('note.txt')).toBe('text/plain')
    expect(inferMimeType('README.md')).toBe('text/markdown')
    expect(inferMimeType('page.html')).toBe('text/html')
    expect(inferMimeType('page.htm')).toBe('text/html')
    expect(inferMimeType('data.csv')).toBe('text/csv')
    expect(inferMimeType('config.yaml')).toBe('application/x-yaml')
    expect(inferMimeType('config.yml')).toBe('application/x-yaml')
    expect(inferMimeType('data.json')).toBe('application/json')
    expect(inferMimeType('doc.xml')).toBe('application/xml')
  })

  test('PDF 和压缩包', () => {
    expect(inferMimeType('report.pdf')).toBe('application/pdf')
    expect(inferMimeType('archive.zip')).toBe('application/zip')
    expect(inferMimeType('backup.tar')).toBe('application/x-tar')
    expect(inferMimeType('logs.gz')).toBe('application/gzip')
  })

  test('图片类型', () => {
    expect(inferMimeType('photo.png')).toBe('image/png')
    expect(inferMimeType('photo.jpg')).toBe('image/jpeg')
    expect(inferMimeType('photo.jpeg')).toBe('image/jpeg')
    expect(inferMimeType('anim.gif')).toBe('image/gif')
    expect(inferMimeType('modern.webp')).toBe('image/webp')
    expect(inferMimeType('icon.ico')).toBe('image/x-icon')
    expect(inferMimeType('logo.svg')).toBe('image/svg+xml')
    expect(inferMimeType('old.bmp')).toBe('image/bmp')
  })

  test('Office 类型', () => {
    expect(inferMimeType('doc.doc')).toBe('application/msword')
    expect(inferMimeType('doc.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(inferMimeType('sheet.xls')).toBe('application/vnd.ms-excel')
    expect(inferMimeType('sheet.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(inferMimeType('slides.ppt')).toBe('application/vnd.ms-powerpoint')
    expect(inferMimeType('slides.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    )
  })

  test('音视频类型', () => {
    expect(inferMimeType('song.mp3')).toBe('audio/mpeg')
    expect(inferMimeType('clip.mp4')).toBe('video/mp4')
    expect(inferMimeType('voice.wav')).toBe('audio/wav')
    expect(inferMimeType('video.webm')).toBe('video/webm')
  })

  test('扩展名大小写不敏感(toLowerCase)', () => {
    expect(inferMimeType('NOTE.TXT')).toBe('text/plain')
    expect(inferMimeType('Photo.PNG')).toBe('image/png')
    expect(inferMimeType('Doc.PDF')).toBe('application/pdf')
    expect(inferMimeType('DOC.DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  test('未知扩展名回退 application/octet-stream', () => {
    expect(inferMimeType('file.xyz')).toBe('application/octet-stream')
    expect(inferMimeType('archive.zzz')).toBe('application/octet-stream')
  })

  test('无扩展名回退 application/octet-stream', () => {
    expect(inferMimeType('file')).toBe('application/octet-stream')
    expect(inferMimeType('/path/to/README')).toBe('application/octet-stream')
  })

  test('带路径的文件名也能正确提取扩展名', () => {
    expect(inferMimeType('/home/user/docs/report.pdf')).toBe('application/pdf')
    expect(inferMimeType('C:\\Users\\me\\note.txt')).toBe('text/plain')
    expect(inferMimeType('./relative/path/image.png')).toBe('image/png')
  })
})
