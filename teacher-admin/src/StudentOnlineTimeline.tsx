import { Empty, Spin, Typography } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { beijingCalendarDateKey, formatBeijingDateTime } from './beijingTime'

const API_BASE_URL = (() => {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (raw) return raw.replace(/\/$/, '')
  return import.meta.env.DEV ? '' : ''
})()

const CAN_USE_API = import.meta.env.DEV || Boolean(API_BASE_URL)

export type OnlineTimelineSegment = {
  type: 'online' | 'offline'
  start: string
  end: string
  session_id?: number
}

export type OnlineTimelineEvent = {
  kind: 'online' | 'offline'
  at: string
  label: string
}

export type OnlineTimelinePayload = {
  student_name?: string
  date: string
  is_today: boolean
  range_start: string
  range_end: string
  segments: OnlineTimelineSegment[]
  events: OnlineTimelineEvent[]
}

function formatTimelineClock(iso: string) {
  const s = formatBeijingDateTime(iso, true)
  return s.length >= 16 ? s.slice(11, 16) : s
}

function formatDurationSeconds(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  if (sec < 60) return `${sec} 秒`
  const minutes = Math.floor(sec / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  return rem > 0 ? `${hours} 小时 ${rem} 分钟` : `${hours} 小时`
}

type StudentOnlineTimelineProps = {
  classId?: number
  studentId?: number
  date: string
  authToken: string
  studentName?: string
}

export function StudentOnlineTimeline({
  classId,
  studentId,
  date,
  authToken,
  studentName,
}: StudentOnlineTimelineProps) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<OnlineTimelinePayload | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      if (!CAN_USE_API || classId == null || studentId == null || !date) {
        setData(null)
        setError('')
        return
      }
      try {
        setLoading(true)
        setError('')
        const params = new URLSearchParams()
        params.set('classId', String(classId))
        params.set('studentId', String(studentId))
        params.set('date', date)
        const response = await fetch(`${API_BASE_URL}/api/dashboard/student-online-timeline?${params.toString()}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.message || `加载失败(${response.status})`)
        const raw = payload?.data as OnlineTimelinePayload | undefined
        if (!raw) throw new Error('时间轴数据为空')
        setData(raw)
      } catch (e) {
        setData(null)
        setError(e instanceof Error ? e.message : '加载时间轴失败')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [authToken, classId, studentId, date])

  const rangeMs = useMemo(() => {
    if (!data) return { start: 0, end: 1 }
    const start = new Date(data.range_start).getTime()
    const end = new Date(data.range_end).getTime()
    return { start, end: Math.max(end, start + 1) }
  }, [data])

  const segmentStyle = (startIso: string, endIso: string) => {
    const start = new Date(startIso).getTime()
    const end = new Date(endIso).getTime()
    const left = ((start - rangeMs.start) / (rangeMs.end - rangeMs.start)) * 100
    const width = ((end - start) / (rangeMs.end - rangeMs.start)) * 100
    return {
      left: `${Math.max(0, Math.min(100, left))}%`,
      width: `${Math.max(0.35, Math.min(100 - left, width))}%`,
    }
  }

  const markerStyle = (atIso: string) => {
    const at = new Date(atIso).getTime()
    const left = ((at - rangeMs.start) / (rangeMs.end - rangeMs.start)) * 100
    return { left: `${Math.max(0, Math.min(100, left))}%` }
  }

  if (classId == null || studentId == null) {
    return <Empty description="请选择学生查看在线时间轴" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  if (loading) {
    return (
      <div className="online-timeline-loading">
        <Spin />
      </div>
    )
  }

  if (error) {
    return <Typography.Text type="danger">{error}</Typography.Text>
  }

  if (!data) {
    return <Empty description="暂无时间轴数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
  }

  const displayName = studentName || data.student_name || '学生'
  const rangeLabelEnd = data.is_today ? '现在' : '24:00'

  return (
    <div className="online-timeline">
      <div className="online-timeline-head">
        <Typography.Text strong>{displayName}</Typography.Text>
        <Typography.Text type="secondary"> · {data.date}</Typography.Text>
        <Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
          绿=在线　红=离线（切出小程序即下线）
        </Typography.Text>
      </div>
      <div className="online-timeline-axis">
        <span>{formatTimelineClock(data.range_start)}</span>
        <span>{rangeLabelEnd}</span>
      </div>
      <div className="online-timeline-track" aria-label="在线时间轴">
        {data.segments.map((seg, index) => (
          <div
            key={`${seg.type}-${seg.start}-${index}`}
            className={`online-timeline-seg online-timeline-seg--${seg.type}`}
            style={segmentStyle(seg.start, seg.end)}
            title={`${seg.type === 'online' ? '在线' : '离线'} ${formatBeijingDateTime(seg.start, true)} ～ ${formatBeijingDateTime(seg.end, true)}`}
          />
        ))}
        {data.events.map((ev, index) => (
          <div
            key={`${ev.kind}-${ev.at}-${index}`}
            className={`online-timeline-marker online-timeline-marker--${ev.kind}`}
            style={markerStyle(ev.at)}
            title={`${ev.label} ${formatBeijingDateTime(ev.at, true)}`}
          />
        ))}
      </div>
      <div className="online-timeline-legend">
        <span className="online-timeline-legend-item">
          <i className="online-timeline-swatch online-timeline-swatch--online" />
          在线
        </span>
        <span className="online-timeline-legend-item">
          <i className="online-timeline-swatch online-timeline-swatch--offline" />
          离线
        </span>
      </div>
      {data.events.length > 0 ? (
        <div className="online-timeline-events">
          <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            上下线记录
          </Typography.Text>
          <ul className="online-timeline-event-list">
            {data.events.map((ev, index) => (
              <li
                key={`${ev.at}-${ev.kind}-${index}`}
                className={`online-timeline-event online-timeline-event--${ev.kind}`}
              >
                <span className="online-timeline-event-time">{formatBeijingDateTime(ev.at, true)}</span>
                <span className="online-timeline-event-label">{ev.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Typography.Text type="secondary">当日暂无上线记录</Typography.Text>
      )}
      {data.is_today && data.date === beijingCalendarDateKey() ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
          时间轴右端为当前时刻；若学生正在使用小程序，末段绿色将持续延伸。
        </Typography.Text>
      ) : null}
    </div>
  )
}

export { formatDurationSeconds as formatOnlineDurationSeconds }
