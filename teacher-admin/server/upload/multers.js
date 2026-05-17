import fs from 'fs'
import multer from 'multer'
import path from 'path'

import { RESOURCE_UPLOAD_MAX_BYTES } from '../config/constants.js'

export const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads')

if (!fs.existsSync(UPLOAD_ROOT)) {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true })
}

const resourceUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_ROOT)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 16)
    const safeBase =
      path.basename(file.originalname || 'resource', ext).replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 60) || 'resource'
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeBase}${ext}`)
  },
})

export const resourceUpload = multer({
  storage: resourceUploadStorage,
  limits: {
    fileSize: RESOURCE_UPLOAD_MAX_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeSet = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/quicktime',
      'audio/mpeg',
      'audio/wav',
    ])
    const allowedExtSet = new Set([
      '.pdf',
      '.doc',
      '.docx',
      '.xls',
      '.xlsx',
      '.ppt',
      '.pptx',
      '.txt',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
      '.gif',
      '.mp4',
      '.mov',
      '.mp3',
      '.wav',
    ])
    const ext = path.extname(file.originalname || '').toLowerCase()
    if (allowedMimeSet.has(file.mimetype) || allowedExtSet.has(ext)) {
      cb(null, true)
      return
    }
    cb(new Error('文件类型不支持'))
  },
})

const avatarUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_ROOT)
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 8).toLowerCase() || '.png'
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`)
  },
})

export const avatarUpload = multer({
  storage: avatarUploadStorage,
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const okMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'].includes(file.mimetype)
    const ext = path.extname(file.originalname || '').toLowerCase()
    const okExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)
    if (okMime || okExt) {
      cb(null, true)
      return
    }
    cb(new Error('仅支持 PNG/JPG/WebP/GIF 图片'))
  },
})
