import {
  AppstoreOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  BookOutlined,
  DownOutlined,
  FileProtectOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
  ReadOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons'
import {
  Avatar,
  Button,
  Card,
  Checkbox,
  Col,
  ConfigProvider,
  Drawer,
  Empty,
  Popover,
  Form,
  Input,
  Layout,
  List,
  Menu,
  message,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd'
import type { MenuProps, TabsProps, UploadFile, UploadProps } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Bar, BarChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'
import * as XLSX from 'xlsx'

const { Header, Sider, Content } = Layout

type RoleType = 'admin' | 'class_teacher' | 'subject_teacher' | 'hybrid'
type ThemeOption = {
  key: string
  name: string
  primary: string
  primaryHover: string
  pageBg: string
  cardBg: string
  pageTint: string
  headerBg: string
  siderBg: string
  tableBg: string
  menuActiveBg: string
  menuHoverBg: string
  tagBg: string
  badgeBg: string
  tableHoverBg: string
  inputFocusRing: string
  modalHeaderBg: string
  paginationActiveBg: string
  progressTrailColor: string
}

const STORAGE_THEME_INDEX = 'teacher-admin-theme-index'

const themeOptions: ThemeOption[] = [
  { key: 'ocean-blue', name: '海洋蓝', primary: '#1677FF', primaryHover: '#3B8CFF', pageBg: '#EEF5FF', cardBg: '#F9FBFF', pageTint: '#DCEAFF', headerBg: '#F5F9FF', siderBg: '#F6FAFF', tableBg: '#F9FCFF', menuActiveBg: '#E7F1FF', menuHoverBg: '#EFF6FF', tagBg: '#E8F1FF', badgeBg: '#1677FF', tableHoverBg: '#EEF5FF', inputFocusRing: 'rgba(22, 119, 255, 0.22)', modalHeaderBg: '#F1F7FF', paginationActiveBg: '#E8F2FF', progressTrailColor: '#DDEBFF' },
  { key: 'mint-green', name: '薄荷绿', primary: '#16A085', primaryHover: '#24B899', pageBg: '#EAFBF6', cardBg: '#F6FFFB', pageTint: '#D3F6EA', headerBg: '#F2FCF8', siderBg: '#F3FDF9', tableBg: '#F7FFFC', menuActiveBg: '#DEF6EE', menuHoverBg: '#EAFBF5', tagBg: '#DFF7EF', badgeBg: '#16A085', tableHoverBg: '#EAFBF6', inputFocusRing: 'rgba(22, 160, 133, 0.22)', modalHeaderBg: '#EEFAF5', paginationActiveBg: '#E1F7EE', progressTrailColor: '#D3F1E7' },
  { key: 'violet', name: '魅影紫', primary: '#7C4DFF', primaryHover: '#9168FF', pageBg: '#F3EEFF', cardBg: '#FBF9FF', pageTint: '#E7DFFF', headerBg: '#F8F5FF', siderBg: '#F9F6FF', tableBg: '#FCFAFF', menuActiveBg: '#ECE4FF', menuHoverBg: '#F3EEFF', tagBg: '#EEE7FF', badgeBg: '#7C4DFF', tableHoverBg: '#F2ECFF', inputFocusRing: 'rgba(124, 77, 255, 0.24)', modalHeaderBg: '#F4EEFF', paginationActiveBg: '#EFE6FF', progressTrailColor: '#E5DBFF' },
  { key: 'sunset-orange', name: '日落橙', primary: '#F97316', primaryHover: '#FB8C3E', pageBg: '#FFF3EA', cardBg: '#FFF9F4', pageTint: '#FFE5D1', headerBg: '#FFF8F3', siderBg: '#FFF9F4', tableBg: '#FFFCF8', menuActiveBg: '#FFECDD', menuHoverBg: '#FFF3E8', tagBg: '#FFEFE1', badgeBg: '#F97316', tableHoverBg: '#FFF2E7', inputFocusRing: 'rgba(249, 115, 22, 0.22)', modalHeaderBg: '#FFF4EB', paginationActiveBg: '#FFEEDD', progressTrailColor: '#FFE3CF' },
  { key: 'rose-pink', name: '玫瑰粉', primary: '#E64980', primaryHover: '#EB6796', pageBg: '#FFF0F6', cardBg: '#FFF9FC', pageTint: '#FFDDEB', headerBg: '#FFF6FA', siderBg: '#FFF7FB', tableBg: '#FFFBFD', menuActiveBg: '#FFE6F0', menuHoverBg: '#FFF1F7', tagBg: '#FFE9F2', badgeBg: '#E64980', tableHoverBg: '#FFF0F6', inputFocusRing: 'rgba(230, 73, 128, 0.23)', modalHeaderBg: '#FFF3F8', paginationActiveBg: '#FFE8F2', progressTrailColor: '#FFDEEC' },
  { key: 'teal', name: '青柠青', primary: '#0EA5A5', primaryHover: '#1DB7B7', pageBg: '#EAFBFB', cardBg: '#F6FFFF', pageTint: '#D6F4F4', headerBg: '#F1FCFC', siderBg: '#F2FDFD', tableBg: '#F8FFFF', menuActiveBg: '#DFF5F5', menuHoverBg: '#EAFBFB', tagBg: '#E3F8F8', badgeBg: '#0EA5A5', tableHoverBg: '#EAFBFB', inputFocusRing: 'rgba(14, 165, 165, 0.22)', modalHeaderBg: '#EEFAFA', paginationActiveBg: '#E2F7F7', progressTrailColor: '#D6F1F1' },
  { key: 'royal-indigo', name: '靛蓝', primary: '#4F46E5', primaryHover: '#675FEA', pageBg: '#EEF0FF', cardBg: '#F8F9FF', pageTint: '#DDE0FF', headerBg: '#F5F6FF', siderBg: '#F6F7FF', tableBg: '#FAFBFF', menuActiveBg: '#E3E6FF', menuHoverBg: '#EEF0FF', tagBg: '#E6E8FF', badgeBg: '#4F46E5', tableHoverBg: '#EEF1FF', inputFocusRing: 'rgba(79, 70, 229, 0.23)', modalHeaderBg: '#F2F3FF', paginationActiveBg: '#E7E9FF', progressTrailColor: '#DBDEFF' },
  { key: 'emerald', name: '祖母绿', primary: '#059669', primaryHover: '#15AB7C', pageBg: '#EBFAF4', cardBg: '#F7FFFB', pageTint: '#D4F4E7', headerBg: '#F2FCF8', siderBg: '#F3FDF9', tableBg: '#F8FFFC', menuActiveBg: '#DDF4E9', menuHoverBg: '#EAF9F3', tagBg: '#E0F6EC', badgeBg: '#059669', tableHoverBg: '#EAF9F2', inputFocusRing: 'rgba(5, 150, 105, 0.22)', modalHeaderBg: '#EFFBF5', paginationActiveBg: '#E3F7EE', progressTrailColor: '#D6F2E4' },
  { key: 'magenta', name: '洋红', primary: '#C026D3', primaryHover: '#CC4BDD', pageBg: '#FCF0FF', cardBg: '#FEF8FF', pageTint: '#F4DBFA', headerBg: '#FDF6FF', siderBg: '#FDF7FF', tableBg: '#FFFBFF', menuActiveBg: '#F4E2F9', menuHoverBg: '#FAEEFF', tagBg: '#F6E6FB', badgeBg: '#C026D3', tableHoverBg: '#FAEEFF', inputFocusRing: 'rgba(192, 38, 211, 0.22)', modalHeaderBg: '#FBF2FF', paginationActiveBg: '#F5E5FA', progressTrailColor: '#EFD9F6' },
  { key: 'gold', name: '琥珀金', primary: '#D97706', primaryHover: '#E48A1F', pageBg: '#FFF7EA', cardBg: '#FFFCF5', pageTint: '#FFEBCB', headerBg: '#FFFBF4', siderBg: '#FFFCF6', tableBg: '#FFFEFA', menuActiveBg: '#FFF0D9', menuHoverBg: '#FFF6E8', tagBg: '#FFF1DD', badgeBg: '#D97706', tableHoverBg: '#FFF6E8', inputFocusRing: 'rgba(217, 119, 6, 0.23)', modalHeaderBg: '#FFF8EE', paginationActiveBg: '#FFF2DD', progressTrailColor: '#FFE8C8' },
]

const classColumns = [
  { title: '班级名称', dataIndex: 'name' },
  { title: '年级', dataIndex: 'grade' },
  { title: '学生人数', dataIndex: 'studentCount' },
  { title: '邀请码', dataIndex: 'inviteCode' },
]

const questionColumns = [
  { title: '题型', dataIndex: 'type' },
  { title: '题干摘要', dataIndex: 'content' },
  { title: '难度', dataIndex: 'difficulty' },
  { title: '最后编辑', dataIndex: 'updatedAt' },
]

const initialQuestionData = [
  { key: '1', id: 1, type: '单选', content: '已知函数 f(x)=x^2+2x+1，下列说法正确的是...', difficulty: '中等', updatedAt: '2026-04-20' },
  { key: '2', id: 2, type: '填空', content: '求抛物线 y=x^2 的顶点坐标', difficulty: '简单', updatedAt: '2026-04-22' },
]

const excelTemplateHeaders = ['科目', '题型', '题干', '选项A', '选项B', '选项C', '选项D', '答案', '解析', '难度', '知识点']
const validQuestionTypes = new Set(['单选', '多选', '判断', '填空', '简答'])
const validDifficulties = new Set(['简单', '中等', '困难'])
/** 生产须配置完整 API 根地址；开发未配置时用同源相对路径，由 vite 代理到后端（见 vite.config.ts）。 */
const API_BASE_URL = (() => {
  const raw = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  if (raw) return raw.replace(/\/$/, '')
  return import.meta.env.DEV ? '' : ''
})()
/** 开发环境允许空 API 根地址（走同源 + 代理）；生产环境必须配置。 */
const CAN_USE_API = import.meta.env.DEV || Boolean(API_BASE_URL)
const AUTH_TOKEN_KEY = 'quizwiz-auth-token'
const AUTH_USER_KEY = 'quizwiz-auth-user'

type QuestionListItem = {
  key: string
  id: number
  type: string
  content: string
  difficulty: string
  updatedAt: string
}

type ImportPayloadRow = {
  subject: string
  type: string
  stem: string
  optionA: string
  optionB: string
  optionC: string
  optionD: string
  answer: string
  explanation: string
  difficulty: string
  knowledgePoints: string[]
}

type AuthUser = {
  id: number
  name: string
  phone: string
  roles: string[]
  avatarUrl?: string
}

type TeacherAccountRow = {
  key: string
  id: number
  name: string
  phone: string
  roles: string[]
  subjects: string[]
  status: number
  created_at?: string
}

const normalizeRoleList = (roles: string[]) => {
  const validRoles = roles.filter(
    (role): role is 'admin' | 'class_teacher' | 'subject_teacher' =>
      role === 'admin' || role === 'class_teacher' || role === 'subject_teacher',
  )
  return Array.from(new Set(validRoles))
}

const resolveEffectiveRole = (roles: string[]): RoleType => {
  const normalized = normalizeRoleList(roles)
  if (normalized.includes('admin')) return 'admin'
  if (normalized.includes('class_teacher') && normalized.includes('subject_teacher')) return 'hybrid'
  if (normalized.includes('class_teacher')) return 'class_teacher'
  if (normalized.includes('subject_teacher')) return 'subject_teacher'
  return 'subject_teacher'
}

const mapQuestionTypeFromApi = (type: string | number) => {
  const mapByNumber: Record<number, string> = { 1: '单选', 2: '多选', 3: '判断', 4: '填空', 5: '简答' }
  if (typeof type === 'number') return mapByNumber[type] ?? String(type)
  if (validQuestionTypes.has(type)) return type
  return String(type)
}

const mapDifficultyFromApi = (difficulty: string | number) => {
  if (typeof difficulty === 'number') {
    if (difficulty === 1) return '简单'
    if (difficulty === 2) return '中等'
    if (difficulty === 3) return '困难'
  }
  if (typeof difficulty === 'string') {
    if (difficulty === '1') return '简单'
    if (difficulty === '2') return '中等'
    if (difficulty === '3') return '困难'
  }
  return String(difficulty || '中等')
}

function LoginPage({ onLoginSuccess }: { onLoginSuccess: (token: string, user: AuthUser) => void }) {
  const navigate = useNavigate()
  const [loginLoading, setLoginLoading] = useState(false)

  const handleLogin = async (values: { phone: string; password: string }) => {
    if (!CAN_USE_API) {
      message.error('未配置 VITE_API_BASE_URL，无法登录（生产构建必须配置）')
      return
    }
    try {
      setLoginLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.message || `登录失败(${response.status})`)
      }
      const token = String(payload?.data?.token || '')
      const user = payload?.data?.user as AuthUser | undefined
      if (!token || !user) {
        throw new Error('登录响应数据不完整')
      }
      onLoginSuccess(token, user)
      message.success(`欢迎回来，${user.name}`)
      navigate('/dashboard', { replace: true })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败')
    } finally {
      setLoginLoading(false)
    }
  }

  return (
    <div className="login-page">
      <Card className="login-card" title="题灵智库管理系统登录">
        <Typography.Paragraph type="secondary">
          使用手机号 + 密码登录，登录成功后自动进入后台。
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={handleLogin}>
          <Form.Item label="手机号" name="phone" rules={[{ required: true, message: '请输入手机号' }]}>
            <Input placeholder="请输入手机号" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={loginLoading} block>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  )
}

function DashboardPage({ role, themePrimary }: { role: RoleType; themePrimary: string }) {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const navigate = useNavigate()
  const [classStatsLoading, setClassStatsLoading] = useState(false)
  const [pendingWarningCount, setPendingWarningCount] = useState(0)
  const [qualityAvgScore, setQualityAvgScore] = useState(0)
  const [qualityPassRate, setQualityPassRate] = useState(0)
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendChartData, setTrendChartData] = useState<Array<{ name: string; score: number }>>([])
  const [overviewMetrics, setOverviewMetrics] = useState({
    class_count: 0,
    student_members_total: 0,
    weighted_submission_rate: 0,
    question_total: 0,
    pending_grade_count: 0,
    ongoing_exam_count: 0,
  })
  const [classStats, setClassStats] = useState<
    Array<{
      class_id: number
      class_name: string
      class_grade: string
      student_count: number
      exam_count: number
      submission_count: number
      submission_rate: number
      avg_score: number
      max_score: number
      min_score: number
    }>
  >([])

  const cards =
    role === 'subject_teacher'
      ? [
          { title: '任教班级数', value: overviewMetrics.class_count },
          { title: '题目总量', value: overviewMetrics.question_total },
          { title: '待批阅答卷', value: overviewMetrics.pending_grade_count },
          { title: '进行中考试', value: overviewMetrics.ongoing_exam_count },
        ]
      : [
          { title: '班级总数', value: overviewMetrics.class_count },
          { title: '学生总数', value: overviewMetrics.student_members_total },
          { title: '平均提交率（可见班级）', value: overviewMetrics.weighted_submission_rate, suffix: '%' as const },
          { title: '待批阅答卷', value: overviewMetrics.pending_grade_count },
        ]

  useEffect(() => {
    const loadOverview = async () => {
      if (!CAN_USE_API) {
        setClassStats([])
        setOverviewMetrics({
          class_count: 0,
          student_members_total: 0,
          weighted_submission_rate: 0,
          question_total: 0,
          pending_grade_count: 0,
          ongoing_exam_count: 0,
        })
        return
      }
      try {
        setClassStatsLoading(true)
        const params = new URLSearchParams()
        params.set('withOverview', '1')
        const response = await fetch(`${API_BASE_URL}/api/dashboard/class-stats?${params.toString()}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (response.status === 403) {
          setClassStats([])
          setOverviewMetrics({
            class_count: 0,
            student_members_total: 0,
            weighted_submission_rate: 0,
            question_total: 0,
            pending_grade_count: 0,
            ongoing_exam_count: 0,
          })
          return
        }
        if (!response.ok) throw new Error(payload?.message || `加载概览失败(${response.status})`)
        const rows = Array.isArray(payload?.data) ? payload.data : []
        setClassStats(rows)
        const m = payload?.overview_metrics
        if (m && typeof m === 'object') {
          setOverviewMetrics({
            class_count: Number(m?.class_count ?? 0),
            student_members_total: Number(m?.student_members_total ?? 0),
            weighted_submission_rate: Number(m?.weighted_submission_rate ?? 0),
            question_total: Number(m?.question_total ?? 0),
            pending_grade_count: Number(m?.pending_grade_count ?? 0),
            ongoing_exam_count: Number(m?.ongoing_exam_count ?? 0),
          })
        } else {
          let denom = 0
          let num = 0
          let sm = 0
          for (const r of rows) {
            const w = Number(r.student_count || 0) * Number(r.exam_count || 0)
            denom += w
            num += Number(r.submission_count || 0)
            sm += Number(r.student_count || 0)
          }
          const weighted = denom > 0 ? Math.round((num / denom) * 10000) / 100 : 0
          let qTotal = 0
          try {
            const qRes = await fetch(`${API_BASE_URL}/api/questions?page=1&pageSize=1`, {
              headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
            })
            const qPayload = await qRes.json().catch(() => ({}))
            if (qRes.ok) qTotal = Number(qPayload?.pagination?.total ?? 0)
          } catch {
            /* 题目总数非关键 */
          }
          setOverviewMetrics({
            class_count: rows.length,
            student_members_total: sm,
            weighted_submission_rate: weighted,
            question_total: qTotal,
            pending_grade_count: 0,
            ongoing_exam_count: 0,
          })
        }
      } catch (error) {
        message.error(error instanceof Error ? error.message : '加载概览失败')
        setClassStats([])
        setOverviewMetrics({
          class_count: 0,
          student_members_total: 0,
          weighted_submission_rate: 0,
          question_total: 0,
          pending_grade_count: 0,
          ongoing_exam_count: 0,
        })
      } finally {
        setClassStatsLoading(false)
      }
    }
    void loadOverview()
  }, [authToken])

  useEffect(() => {
    const loadTrend = async () => {
      if (!CAN_USE_API) {
        setTrendChartData([])
        return
      }
      try {
        setTrendLoading(true)
        const params = new URLSearchParams()
        params.set('trendLimit', '5')
        const response = await fetch(`${API_BASE_URL}/api/analytics/class-performance?${params.toString()}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          setTrendChartData([])
          return
        }
        const trendRows = Array.isArray(payload?.data?.trend_rows) ? payload.data.trend_rows : []
        const mapped = trendRows.map((row: Record<string, unknown>, index: number) => {
          const title = String(row.exam_title || `考试${index + 1}`)
          const short = title.length > 10 ? `${title.slice(0, 10)}…` : title
          return {
            name: short,
            score: Number(row.avg_score ?? 0),
          }
        })
        setTrendChartData(mapped)
      } catch {
        setTrendChartData([])
      } finally {
        setTrendLoading(false)
      }
    }
    void loadTrend()
  }, [authToken])

  useEffect(() => {
    const loadOverviewCards = async () => {
      if (!CAN_USE_API) {
        setPendingWarningCount(0)
        setQualityAvgScore(0)
        setQualityPassRate(0)
        return
      }
      try {
        const [warningRes, qualityRes] = await Promise.all([
          fetch(`${API_BASE_URL}/api/analytics/student-warnings?handleStatus=pending`, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
          }),
          fetch(`${API_BASE_URL}/api/analytics/exam-quality-overview`, {
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
          }),
        ])
        const warningPayload = await warningRes.json().catch(() => ({}))
        const qualityPayload = await qualityRes.json().catch(() => ({}))
        if (warningRes.ok) {
          const rows = Array.isArray(warningPayload?.data?.rows) ? warningPayload.data.rows : []
          setPendingWarningCount(rows.length)
        } else {
          setPendingWarningCount(0)
        }
        if (qualityRes.ok) {
          setQualityAvgScore(Number(qualityPayload?.data?.summary?.avg_score || 0))
          setQualityPassRate(Number(qualityPayload?.data?.summary?.pass_rate || 0))
        } else {
          setQualityAvgScore(0)
          setQualityPassRate(0)
        }
      } catch {
        setPendingWarningCount(0)
        setQualityAvgScore(0)
        setQualityPassRate(0)
      }
    }
    void loadOverviewCards()
  }, [authToken])

  const todoItems = useMemo(() => {
    const items: string[] = []
    if (pendingWarningCount > 0) {
      items.push(`学业预警待处理 ${pendingWarningCount} 条（请前往「学情分析」处理）`)
    }
    if (overviewMetrics.pending_grade_count > 0) {
      items.push(`待批阅答卷 ${overviewMetrics.pending_grade_count} 份`)
    }
    if (overviewMetrics.ongoing_exam_count > 0) {
      items.push(`进行中考试 ${overviewMetrics.ongoing_exam_count} 场`)
    }
    return items
  }, [pendingWarningCount, overviewMetrics.pending_grade_count, overviewMetrics.ongoing_exam_count])

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={16}>
        {cards.map((item) => (
          <Col span={6} key={item.title}>
            <Card>
              <Statistic
                title={item.title}
                value={item.value}
                suffix={'suffix' in item ? item.suffix : undefined}
                precision={item.title.includes('提交率') ? 2 : 0}
              />
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={16}>
        <Col span={8}>
          <Card>
            <Statistic title="待处理学业预警" value={pendingWarningCount} valueStyle={{ color: pendingWarningCount > 0 ? '#cf1322' : undefined }} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="最近考试质量平均分" value={qualityAvgScore} precision={2} />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="最近考试质量及格率" value={qualityPassRate} suffix="%" precision={2} />
          </Card>
        </Col>
      </Row>
      <Card title="班级维度统计（概览）">
        <Table
          loading={classStatsLoading}
          rowKey="class_id"
          pagination={{ pageSize: 6 }}
          dataSource={classStats}
          columns={[
            { title: '班级', dataIndex: 'class_name', width: 140 },
            { title: '年级', dataIndex: 'class_grade', width: 100 },
            { title: '学生数', dataIndex: 'student_count', width: 90 },
            { title: '考试场次', dataIndex: 'exam_count', width: 100 },
            { title: '提交率', render: (_: unknown, row: { submission_rate: number }) => `${row.submission_rate}%`, width: 100 },
            { title: '平均分', dataIndex: 'avg_score', width: 90 },
            { title: '最高分', dataIndex: 'max_score', width: 90 },
            { title: '最低分', dataIndex: 'min_score', width: 90 },
          ]}
        />
      </Card>
      <Card title="近期成绩趋势（默认首个可见班级，最近 5 次考试均分）" loading={trendLoading}>
        <div style={{ width: '100%', height: 280 }}>
          {trendChartData.length === 0 ? (
            <Empty description="暂无趋势数据（需有关联班级与考试记录）" />
          ) : (
            <ResponsiveContainer>
              <LineChart data={trendChartData}>
                <XAxis dataKey="name" />
                <YAxis />
                <RechartsTooltip />
                <Line type="monotone" dataKey="score" stroke={themePrimary} strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="快捷操作">
            <Space wrap>
              <Button type="primary" onClick={() => navigate('/classes')}>
                班级管理
              </Button>
              <Button onClick={() => navigate('/exams')}>考试管理</Button>
              <Button onClick={() => navigate('/question-bank')}>题库中心</Button>
              <Button onClick={() => navigate('/resources')}>资料库</Button>
              <Button onClick={() => navigate('/analytics')}>学情分析</Button>
            </Space>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="待办提示（来自真实统计）">
            <List
              dataSource={todoItems.length > 0 ? todoItems : ['暂无待办事项']}
              renderItem={(item) => <List.Item>{item}</List.Item>}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  )
}

function ClassPage() {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const authUserRaw = localStorage.getItem(AUTH_USER_KEY)
  const authUser: AuthUser | null = useMemo(() => {
    if (!authUserRaw) return null
    try {
      return JSON.parse(authUserRaw) as AuthUser
    } catch {
      return null
    }
  }, [authUserRaw])
  const canManageClass = Boolean(authUser?.roles?.includes('admin') || authUser?.roles?.includes('class_teacher'))
  const [openCreate, setOpenCreate] = useState(false)
  const [openDetail, setOpenDetail] = useState(false)
  const [openAddStudent, setOpenAddStudent] = useState(false)
  const [openAddTeacher, setOpenAddTeacher] = useState(false)
  const [classRows, setClassRows] = useState<
    Array<{
      key: string
      id: number
      name: string
      grade: string
      studentCount: number
      inviteCode: string
      inviteEnabled: boolean
      inviteExpiresAt?: string
      joinAuditMode?: string
    }>
  >([])
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null)
  const [students, setStudents] = useState<Array<{ id: number; name: string; student_no: string }>>([])
  const [teacherRows, setTeacherRows] = useState<
    Array<{ key: string; teacher_id: number; teacher_name: string; teacher_phone: string; subject_id: number; subject_name: string }>
  >([])
  const [teacherOptions, setTeacherOptions] = useState<Array<{ label: string; value: number; subjectIds: number[] }>>([])
  const [subjectOptions, setSubjectOptions] = useState<Array<{ label: string; value: number }>>([])
  const [loading, setLoading] = useState(false)
  const [studentsLoading, setStudentsLoading] = useState(false)
  const [teachersLoading, setTeachersLoading] = useState(false)
  const [inviteConfigLoading, setInviteConfigLoading] = useState(false)
  const [inviteEnabled, setInviteEnabled] = useState(true)
  const [inviteExpiresAt, setInviteExpiresAt] = useState('')
  const [joinAuditMode, setJoinAuditMode] = useState<'auto' | 'manual'>('auto')
  const [inviteJoinLogs, setInviteJoinLogs] = useState<
    Array<{ id: number; join_channel: string; invite_code?: string; joined_at: string; student_name?: string; student_no?: string }>
  >([])
  const [joinRequests, setJoinRequests] = useState<
    Array<{ id: number; student_name: string; student_no: string; source: string; requested_at: string }>
  >([])
  const [createForm] = Form.useForm()
  const [addStudentForm] = Form.useForm()
  const [addTeacherForm] = Form.useForm()

  const loadClasses = async () => {
    if (!CAN_USE_API) return
    try {
      setLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/classes`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载班级失败(${response.status})`)
      const rows = (Array.isArray(payload?.data) ? payload.data : []).map((item: Record<string, unknown>) => ({
        key: String(item.id),
        id: Number(item.id),
        name: String(item.name ?? ''),
        grade: String(item.grade ?? ''),
        studentCount: Number(item.student_count ?? 0),
        inviteCode: String(item.invite_code ?? ''),
        inviteEnabled: Boolean(item.invite_enabled ?? true),
        inviteExpiresAt: String(item.invite_expires_at ?? ''),
        joinAuditMode: String(item.join_audit_mode ?? 'auto'),
      }))
      setClassRows(rows)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载班级失败')
    } finally {
      setLoading(false)
    }
  }

  const loadInviteConfig = async (classId: number) => {
    if (!CAN_USE_API) return
    try {
      setInviteConfigLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/invite-config`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载邀请码配置失败(${response.status})`)
      const data = payload?.data || {}
      setInviteEnabled(Boolean(data.invite_enabled ?? true))
      setJoinAuditMode(String(data.join_audit_mode ?? 'auto') === 'manual' ? 'manual' : 'auto')
      setInviteExpiresAt(
        data.invite_expires_at
          ? (() => {
              const date = new Date(String(data.invite_expires_at))
              date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
              return date.toISOString().slice(0, 16)
            })()
          : '',
      )
      setInviteJoinLogs(Array.isArray(data.join_logs) ? data.join_logs : [])
      setJoinRequests(Array.isArray(data.join_requests) ? data.join_requests : [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载邀请码配置失败')
    } finally {
      setInviteConfigLoading(false)
    }
  }

  const loadStudents = async (classId: number) => {
    if (!CAN_USE_API) return
    try {
      setStudentsLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/students`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载学生失败(${response.status})`)
      setStudents(Array.isArray(payload?.data) ? payload.data : [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载学生失败')
    } finally {
      setStudentsLoading(false)
    }
  }

  const loadTeachers = async (classId: number) => {
    if (!CAN_USE_API) return
    try {
      setTeachersLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/teachers`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载科任失败(${response.status})`)
      setTeacherRows(
        (Array.isArray(payload?.data) ? payload.data : []).map((item: Record<string, unknown>, index: number) => ({
          key: `${item.teacher_id}-${item.subject_id}-${index}`,
          teacher_id: Number(item.teacher_id),
          teacher_name: String(item.teacher_name ?? ''),
          teacher_phone: String(item.teacher_phone ?? ''),
          subject_id: Number(item.subject_id),
          subject_name: String(item.subject_name ?? ''),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载科任教师失败')
    } finally {
      setTeachersLoading(false)
    }
  }

  const loadTeacherCandidates = async () => {
    if (!CAN_USE_API) return
    try {
      const [teachersRes, subjectsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/teachers`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        }),
        fetch(`${API_BASE_URL}/api/subjects`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        }),
      ])
      const teachersPayload = await teachersRes.json().catch(() => ({}))
      const subjectsPayload = await subjectsRes.json().catch(() => ({}))
      if (!teachersRes.ok) throw new Error(teachersPayload?.message || `加载教师候选失败(${teachersRes.status})`)
      if (!subjectsRes.ok) throw new Error(subjectsPayload?.message || `加载科目失败(${subjectsRes.status})`)
      setTeacherOptions(
        (Array.isArray(teachersPayload?.data) ? teachersPayload.data : []).map((item: Record<string, unknown>) => ({
          label: `${String(item.name ?? '')}（${String(item.phone ?? '')}）`,
          value: Number(item.id),
          subjectIds: Array.isArray(item.subject_ids) ? (item.subject_ids as number[]).map(Number) : [],
        })),
      )
      setSubjectOptions(
        (Array.isArray(subjectsPayload?.data) ? subjectsPayload.data : []).map((item: Record<string, unknown>) => ({
          label: String(item.name ?? ''),
          value: Number(item.id),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载教师或科目失败')
    }
  }

  useEffect(() => {
    void loadClasses()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card
      title="班级管理"
      extra={
        <Space>
          <Button
            onClick={() => {
              const firstClass = classRows[0]
              if (!firstClass) {
                message.warning('暂无班级可查看')
                return
              }
              setSelectedClassId(firstClass.id)
              void loadStudents(firstClass.id)
              void loadTeachers(firstClass.id)
              void loadInviteConfig(firstClass.id)
              setOpenDetail(true)
            }}
          >
            查看班级详情
          </Button>
          {canManageClass ? (
            <Button type="primary" onClick={() => setOpenCreate(true)}>
              创建班级
            </Button>
          ) : null}
        </Space>
      }
    >
      <Table
        loading={loading}
        columns={[
          ...classColumns,
          {
            title: '操作',
            key: 'actions',
            render: (_: unknown, record: { id: number }) => (
              <Button
                type="link"
                onClick={() => {
                  setSelectedClassId(record.id)
                  void loadStudents(record.id)
                  void loadTeachers(record.id)
                  void loadInviteConfig(record.id)
                  setOpenDetail(true)
                }}
              >
                查看成员
              </Button>
            ),
          },
        ]}
        dataSource={classRows}
        pagination={{ pageSize: 20 }}
      />

      {canManageClass ? (
        <Modal
          open={openCreate}
          title="创建班级"
          onCancel={() => setOpenCreate(false)}
          onOk={() => createForm.submit()}
        >
          <Form
            form={createForm}
            layout="vertical"
            onFinish={async (values: { name: string; grade: string }) => {
              if (!CAN_USE_API) return
              try {
                const response = await fetch(`${API_BASE_URL}/api/classes`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                  },
                  body: JSON.stringify(values),
                })
                const payload = await response.json().catch(() => ({}))
                if (!response.ok) throw new Error(payload?.message || `创建失败(${response.status})`)
                message.success('班级创建成功')
                createForm.resetFields()
                setOpenCreate(false)
                await loadClasses()
              } catch (error) {
                message.error(error instanceof Error ? error.message : '创建班级失败')
              }
            }}
          >
            <Form.Item name="name" label="班级名称" rules={[{ required: true, message: '请输入班级名称' }]}>
              <Input placeholder="例如：高一(3)班" />
            </Form.Item>
            <Form.Item name="grade" label="年级" required>
              <Select options={[{ value: '高一', label: '高一' }, { value: '高二', label: '高二' }, { value: '高三', label: '高三' }]} />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}

      <Drawer open={openDetail} title="班级详情" width={920} onClose={() => setOpenDetail(false)}>
        <Tabs
          items={[
            {
              key: 'students',
              label: '学生列表',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {canManageClass ? (
                    <Space>
                      <Button type="primary" onClick={() => setOpenAddStudent(true)}>
                        手动添加学生
                      </Button>
                      <Button
                        onClick={async () => {
                          if (!selectedClassId) return
                          if (!CAN_USE_API) return
                          try {
                            const response = await fetch(`${API_BASE_URL}/api/classes/${selectedClassId}/invite-code/reset`, {
                              method: 'POST',
                              headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                            })
                            const payload = await response.json().catch(() => ({}))
                            if (!response.ok) throw new Error(payload?.message || `重置失败(${response.status})`)
                            message.success(`邀请码已重置：${payload?.data?.invite_code}`)
                            await loadClasses()
                          } catch (error) {
                            message.error(error instanceof Error ? error.message : '重置邀请码失败')
                          }
                        }}
                      >
                        重置邀请码
                      </Button>
                    </Space>
                  ) : null}
                  <Table
                    loading={studentsLoading}
                    columns={[
                      { title: '姓名', dataIndex: 'name' },
                      { title: '学号', dataIndex: 'student_no' },
                      ...(canManageClass
                        ? [
                            {
                              title: '操作',
                              key: 'action',
                              render: (_: unknown, row: { id: number; name: string }) => (
                                <Button
                                  danger
                                  type="link"
                                  onClick={async () => {
                                    if (!selectedClassId || !CAN_USE_API) return
                                    try {
                                      const response = await fetch(
                                        `${API_BASE_URL}/api/classes/${selectedClassId}/students/${row.id}`,
                                        {
                                          method: 'DELETE',
                                          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                        },
                                      )
                                      const payload = await response.json().catch(() => ({}))
                                      if (!response.ok) throw new Error(payload?.message || `移出失败(${response.status})`)
                                      message.success(`已移出 ${row.name}`)
                                      await loadStudents(selectedClassId)
                                      await loadClasses()
                                    } catch (error) {
                                      message.error(error instanceof Error ? error.message : '移出学生失败')
                                    }
                                  }}
                                >
                                  移出班级
                                </Button>
                              ),
                            },
                          ]
                        : []),
                    ]}
                    dataSource={students.map((student) => ({ ...student, key: String(student.id) }))}
                  />
                </Space>
              ),
            },
            {
              key: 'teachers',
              label: '科任教师列表',
              children: (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {canManageClass ? (
                    <Button
                      type="primary"
                      onClick={async () => {
                        await loadTeacherCandidates()
                        addTeacherForm.resetFields()
                        setOpenAddTeacher(true)
                      }}
                    >
                      添加科任教师
                    </Button>
                  ) : null}
                  <Table
                    loading={teachersLoading}
                    columns={[
                      { title: '姓名', dataIndex: 'teacher_name' },
                      { title: '手机号', dataIndex: 'teacher_phone' },
                      { title: '科目', dataIndex: 'subject_name' },
                      ...(canManageClass
                        ? [
                            {
                              title: '操作',
                              key: 'action',
                              render: (_: unknown, row: { teacher_id: number; subject_id: number; teacher_name: string }) => (
                                <Button
                                  danger
                                  type="link"
                                  onClick={async () => {
                                    if (!selectedClassId || !CAN_USE_API) return
                                    try {
                                      const response = await fetch(
                                        `${API_BASE_URL}/api/classes/${selectedClassId}/teachers/${row.teacher_id}/${row.subject_id}`,
                                        {
                                          method: 'DELETE',
                                          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                        },
                                      )
                                      const payload = await response.json().catch(() => ({}))
                                      if (!response.ok) throw new Error(payload?.message || `移除失败(${response.status})`)
                                      message.success(`已移除 ${row.teacher_name}`)
                                      await loadTeachers(selectedClassId)
                                    } catch (error) {
                                      message.error(error instanceof Error ? error.message : '移除科任教师失败')
                                    }
                                  }}
                                >
                                  移除
                                </Button>
                              ),
                            },
                          ]
                        : []),
                    ]}
                    dataSource={teacherRows}
                  />
                </Space>
              ),
            },
          ]}
        />
        <Card title="邀请码管理" style={{ marginTop: 16 }} loading={inviteConfigLoading}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Space>
              <Tag color={inviteEnabled ? 'green' : 'default'}>{inviteEnabled ? '已启用' : '已停用'}</Tag>
              <Tag color="blue">
                {(classRows.find((item) => item.id === selectedClassId)?.inviteCode || '------').toUpperCase()}
              </Tag>
              <Button
                onClick={() => {
                  const code = classRows.find((item) => item.id === selectedClassId)?.inviteCode
                  if (!code) return
                  navigator.clipboard.writeText(code)
                  message.success('邀请码已复制')
                }}
              >
                复制邀请码
              </Button>
              {canManageClass ? (
                <Button
                  onClick={async () => {
                    if (!selectedClassId || !CAN_USE_API) return
                    try {
                      const response = await fetch(`${API_BASE_URL}/api/classes/${selectedClassId}/invite-code/reset`, {
                        method: 'POST',
                        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                      })
                      const payload = await response.json().catch(() => ({}))
                      if (!response.ok) throw new Error(payload?.message || `重置失败(${response.status})`)
                      message.success(`邀请码已重置：${payload?.data?.invite_code}`)
                      await loadClasses()
                      await loadInviteConfig(selectedClassId)
                    } catch (error) {
                      message.error(error instanceof Error ? error.message : '重置邀请码失败')
                    }
                  }}
                >
                  重置邀请码
                </Button>
              ) : null}
            </Space>
            <Typography.Text type="secondary">
              有效期：{inviteExpiresAt ? inviteExpiresAt.replace('T', ' ') : '永久有效（未设置过期）'}
            </Typography.Text>
            {canManageClass ? (
              <Space>
                <Switch checked={inviteEnabled} onChange={setInviteEnabled} checkedChildren="启用" unCheckedChildren="停用" />
                <Select
                  value={joinAuditMode}
                  onChange={(value: 'auto' | 'manual') => setJoinAuditMode(value)}
                  style={{ width: 170 }}
                  options={[
                    { value: 'auto', label: '自动通过入班' },
                    { value: 'manual', label: '班主任审核入班' },
                  ]}
                />
                <Input
                  type="datetime-local"
                  value={inviteExpiresAt}
                  onChange={(e) => setInviteExpiresAt(e.target.value)}
                  style={{ width: 220 }}
                />
                <Button
                  type="primary"
                  onClick={async () => {
                    if (!selectedClassId || !CAN_USE_API) return
                    try {
                      const response = await fetch(`${API_BASE_URL}/api/classes/${selectedClassId}/invite-config`, {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                        },
                        body: JSON.stringify({
                          inviteEnabled,
                          joinAuditMode,
                          inviteExpiresAt: inviteExpiresAt ? new Date(inviteExpiresAt).toISOString() : null,
                        }),
                      })
                      const payload = await response.json().catch(() => ({}))
                      if (!response.ok) throw new Error(payload?.message || `保存失败(${response.status})`)
                      message.success('邀请码配置已保存')
                      await loadClasses()
                      await loadInviteConfig(selectedClassId)
                    } catch (error) {
                      message.error(error instanceof Error ? error.message : '保存邀请码配置失败')
                    }
                  }}
                >
                  保存配置
                </Button>
              </Space>
            ) : null}
            <Table
              size="small"
              pagination={{ pageSize: 5 }}
              dataSource={inviteJoinLogs.map((item) => ({ ...item, key: String(item.id) }))}
              columns={[
                { title: '时间', dataIndex: 'joined_at', render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '-') },
                { title: '学生', dataIndex: 'student_name', render: (v?: string) => v || '-' },
                { title: '学号', dataIndex: 'student_no', render: (v?: string) => v || '-' },
                { title: '加入来源', dataIndex: 'join_channel' },
                { title: '邀请码', dataIndex: 'invite_code', render: (v?: string) => (v || '-').toUpperCase() },
              ]}
            />
            <Card size="small" title="待审核入班申请">
              <Table
                size="small"
                pagination={{ pageSize: 5 }}
                dataSource={joinRequests.map((item) => ({ ...item, key: String(item.id) }))}
                columns={[
                  { title: '申请时间', dataIndex: 'requested_at', render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '-') },
                  { title: '学生姓名', dataIndex: 'student_name' },
                  { title: '学号', dataIndex: 'student_no' },
                  { title: '来源', dataIndex: 'source' },
                  ...(canManageClass
                    ? [
                        {
                          title: '操作',
                          key: 'action',
                          render: (_: unknown, row: { id: number }) => (
                            <Space>
                              <Button
                                type="link"
                                onClick={async () => {
                                  if (!selectedClassId || !CAN_USE_API) return
                                  try {
                                    const response = await fetch(`${API_BASE_URL}/api/classes/${selectedClassId}/join-requests/${row.id}`, {
                                      method: 'PATCH',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                                      },
                                      body: JSON.stringify({ action: 'approve' }),
                                    })
                                    const payload = await response.json().catch(() => ({}))
                                    if (!response.ok) throw new Error(payload?.message || `审核失败(${response.status})`)
                                    message.success('已通过入班申请')
                                    await loadStudents(selectedClassId)
                                    await loadClasses()
                                    await loadInviteConfig(selectedClassId)
                                  } catch (error) {
                                    message.error(error instanceof Error ? error.message : '通过入班申请失败')
                                  }
                                }}
                              >
                                通过
                              </Button>
                              <Button
                                danger
                                type="link"
                                onClick={async () => {
                                  if (!selectedClassId || !CAN_USE_API) return
                                  try {
                                    const response = await fetch(`${API_BASE_URL}/api/classes/${selectedClassId}/join-requests/${row.id}`, {
                                      method: 'PATCH',
                                      headers: {
                                        'Content-Type': 'application/json',
                                        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                                      },
                                      body: JSON.stringify({ action: 'reject' }),
                                    })
                                    const payload = await response.json().catch(() => ({}))
                                    if (!response.ok) throw new Error(payload?.message || `审核失败(${response.status})`)
                                    message.success('已拒绝入班申请')
                                    await loadInviteConfig(selectedClassId)
                                  } catch (error) {
                                    message.error(error instanceof Error ? error.message : '拒绝入班申请失败')
                                  }
                                }}
                              >
                                拒绝
                              </Button>
                            </Space>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
            </Card>
          </Space>
        </Card>
      </Drawer>

      {canManageClass ? (
        <Modal
          open={openAddStudent}
          title="添加学生"
          onCancel={() => setOpenAddStudent(false)}
          onOk={() => addStudentForm.submit()}
        >
          <Form
            form={addStudentForm}
            layout="vertical"
            onFinish={async (values: { name: string; studentNo: string }) => {
              if (!selectedClassId || !CAN_USE_API) return
              try {
                const response = await fetch(`${API_BASE_URL}/api/classes/${selectedClassId}/students`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                  },
                  body: JSON.stringify(values),
                })
                const payload = await response.json().catch(() => ({}))
                if (!response.ok) throw new Error(payload?.message || `添加失败(${response.status})`)
                message.success('学生添加成功')
                addStudentForm.resetFields()
                setOpenAddStudent(false)
                await loadStudents(selectedClassId)
                await loadClasses()
              } catch (error) {
                message.error(error instanceof Error ? error.message : '添加学生失败')
              }
            }}
          >
            <Form.Item name="name" label="学生姓名" rules={[{ required: true, message: '请输入学生姓名' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="studentNo" label="学号" rules={[{ required: true, message: '请输入学号' }]}>
              <Input />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}

      {canManageClass ? (
        <Modal
          open={openAddTeacher}
          title="添加科任教师"
          onCancel={() => setOpenAddTeacher(false)}
          onOk={() => addTeacherForm.submit()}
        >
          <Form
            form={addTeacherForm}
            layout="vertical"
            onFinish={async (values: { teacherId: number; subjectId: number }) => {
              if (!selectedClassId || !CAN_USE_API) return
              try {
                const response = await fetch(`${API_BASE_URL}/api/classes/${selectedClassId}/teachers`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                  },
                  body: JSON.stringify(values),
                })
                const payload = await response.json().catch(() => ({}))
                if (!response.ok) throw new Error(payload?.message || `添加失败(${response.status})`)
                message.success('科任教师添加成功')
                addTeacherForm.resetFields()
                setOpenAddTeacher(false)
                await loadTeachers(selectedClassId)
              } catch (error) {
                message.error(error instanceof Error ? error.message : '添加科任教师失败')
              }
            }}
          >
            <Form.Item name="teacherId" label="科任教师" rules={[{ required: true, message: '请选择科任教师' }]}>
              <Select options={teacherOptions.map((item) => ({ label: item.label, value: item.value }))} />
            </Form.Item>
            <Form.Item noStyle shouldUpdate>
              {({ getFieldValue }) => {
                const selectedTeacherId = Number(getFieldValue('teacherId'))
                const currentTeacher = teacherOptions.find((item) => item.value === selectedTeacherId)
                const filteredSubjects = currentTeacher
                  ? subjectOptions.filter((subject) => currentTeacher.subjectIds.includes(subject.value))
                  : subjectOptions
                return (
                  <Form.Item name="subjectId" label="授课科目" rules={[{ required: true, message: '请选择科目' }]}>
                    <Select options={filteredSubjects} />
                  </Form.Item>
                )
              }}
            </Form.Item>
          </Form>
        </Modal>
      ) : null}
    </Card>
  )
}

function QuestionBankPage() {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const [createForm] = Form.useForm()
  const [batchForm] = Form.useForm()
  const [openDrawer, setOpenDrawer] = useState(false)
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null)
  const [openImport, setOpenImport] = useState(false)
  const [openBatchUpdate, setOpenBatchUpdate] = useState(false)
  const [openDuplicateCheck, setOpenDuplicateCheck] = useState(false)
  const [openRecycleBin, setOpenRecycleBin] = useState(false)
  const [openQualityAudit, setOpenQualityAudit] = useState(false)
  const [qualityAuditLoading, setQualityAuditLoading] = useState(false)
  const [qualityAuditFixing, setQualityAuditFixing] = useState(false)
  const [qualityAuditIssueFilter, setQualityAuditIssueFilter] = useState<string | undefined>(undefined)
  const [qualityAuditSummary, setQualityAuditSummary] = useState<Array<{ issue_code: string; issue_label: string; count: number }>>([])
  const [qualityAuditRows, setQualityAuditRows] = useState<
    Array<{
      key: string
      question_id: number
      subject_name: string
      question_type_text: string
      stem: string
      issue_code: string
      issue_label: string
    }>
  >([])
  const [openVersionHistory, setOpenVersionHistory] = useState(false)
  const [versionLoading, setVersionLoading] = useState(false)
  const [versionQuestionId, setVersionQuestionId] = useState<number | null>(null)
  const [versionRows, setVersionRows] = useState<
    Array<{
      key: string
      id: number
      action: string
      operator_name: string
      created_at: string
      snapshot: Record<string, unknown>
    }>
  >([])
  const [openPreview, setOpenPreview] = useState(false)
  const [questionRows, setQuestionRows] = useState<QuestionListItem[]>(initialQuestionData)
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([])
  const [tableLoading, setTableLoading] = useState(false)
  const [importSubmitting, setImportSubmitting] = useState(false)
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [recycleLoading, setRecycleLoading] = useState(false)
  const [recycleSubmitting, setRecycleSubmitting] = useState(false)
  const [selectedRecycleIds, setSelectedRecycleIds] = useState<number[]>([])
  const [recycleRows, setRecycleRows] = useState<
    Array<{
      key: string
      id: number
      subject_name: string
      question_type_text: string
      stem: string
      difficulty_text: string
      deleted_at: string
    }>
  >([])
  const [duplicateLoading, setDuplicateLoading] = useState(false)
  const [duplicateMergeLoading, setDuplicateMergeLoading] = useState(false)
  const [duplicateStatusFilter, setDuplicateStatusFilter] = useState<string | undefined>(undefined)
  const [duplicateMergeOpen, setDuplicateMergeOpen] = useState(false)
  const [duplicateMergeGroupKey, setDuplicateMergeGroupKey] = useState('')
  const [duplicateMergeKeepId, setDuplicateMergeKeepId] = useState<number | undefined>(undefined)
  const [duplicateMergeRows, setDuplicateMergeRows] = useState<
    Array<{
      question_id: number
      stem: string
      question_type_text: string
      updated_at: string
    }>
  >([])
  const [duplicateRows, setDuplicateRows] = useState<
    Array<{
      key: string
      question_id: number
      subject_name: string
      question_type_text: string
      stem: string
      updated_at: string
      duplicate_count: number
      duplicate_group_key: string
      mark_status: string
      note: string
    }>
  >([])
  const [subjectFilter, setSubjectFilter] = useState<string | undefined>(undefined)
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined)
  const [keywordFilter, setKeywordFilter] = useState('')
  const [questionListPage, setQuestionListPage] = useState(1)
  const [questionListPageSize, setQuestionListPageSize] = useState(20)
  const [questionListTotal, setQuestionListTotal] = useState(0)
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [importPreviewRows, setImportPreviewRows] = useState<QuestionListItem[]>([])
  const [importPayloadRows, setImportPayloadRows] = useState<ImportPayloadRow[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [subjectOptions, setSubjectOptions] = useState<Array<{ label: string; value: string }>>([])

  const loadQuestionList = async (overrides?: { subject?: string; type?: string; keyword?: string; page?: number; pageSize?: number }) => {
    if (!CAN_USE_API) {
      message.warning('未配置 VITE_API_BASE_URL，当前展示本地示例数据')
      setQuestionRows(initialQuestionData)
      setQuestionListTotal(initialQuestionData.length)
      return
    }
    try {
      setTableLoading(true)
      const params = new URLSearchParams()
      const effectiveSubject = overrides?.subject ?? subjectFilter
      const effectiveType = overrides?.type ?? typeFilter
      const effectiveKeyword = overrides?.keyword ?? keywordFilter
      const page = overrides?.page ?? questionListPage
      const pageSize = overrides?.pageSize ?? questionListPageSize
      if (effectiveSubject) params.set('subject', effectiveSubject)
      if (effectiveType) params.set('type', effectiveType)
      if (effectiveKeyword.trim()) params.set('keyword', effectiveKeyword.trim())
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const response = await fetch(`${API_BASE_URL}/api/questions?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      if (!response.ok) {
        if (response.status === 401) throw new Error('登录已过期，请重新登录')
        if (response.status === 403) {
          setQuestionRows([])
          setQuestionListTotal(0)
          setSelectedQuestionIds([])
          setQuestionListPage(page)
          setQuestionListPageSize(pageSize)
          return
        }
        throw new Error(`题库列表接口失败(${response.status})`)
      }
      const payload = await response.json()
      const rows: QuestionListItem[] = (Array.isArray(payload?.data) ? payload.data : []).map(
        (item: Record<string, unknown>, index: number) => ({
          key: String(item.id ?? `api-${index}`),
          id: Number(item.id ?? 0),
          type: mapQuestionTypeFromApi(item.question_type as string | number),
          content: String(item.stem ?? item.content ?? '').slice(0, 50),
          difficulty: String(item.difficulty_text ?? mapDifficultyFromApi(item.difficulty as string | number)),
          updatedAt: String(item.updated_at ?? item.updatedAt ?? '').slice(0, 10),
        }),
      )
      setQuestionListPage(page)
      setQuestionListPageSize(pageSize)
      setQuestionListTotal(Number(payload?.pagination?.total ?? rows.length))
      setQuestionRows(rows)
      setSelectedQuestionIds((prev) => prev.filter((id) => rows.some((row) => row.id === id)))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载题库失败')
    } finally {
      setTableLoading(false)
    }
  }

  useEffect(() => {
    void loadQuestionList({ page: 1, pageSize: 20 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const loadSubjectOptions = async () => {
      if (!CAN_USE_API) return
      try {
        const response = await fetch(`${API_BASE_URL}/api/subjects`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          if (response.status === 403) {
            setSubjectOptions([])
            return
          }
          throw new Error(payload?.message || `加载科目失败(${response.status})`)
        }
        setSubjectOptions(
          (Array.isArray(payload?.data) ? payload.data : []).map((item: Record<string, unknown>) => ({
            label: String(item.name ?? ''),
            value: String(item.name ?? ''),
          })),
        )
      } catch (error) {
        message.error(error instanceof Error ? error.message : '加载科目失败')
      }
    }
    void loadSubjectOptions()
  }, [authToken])

  const downloadTemplate = () => {
    const exampleRows = [
      {
        科目: '数学',
        题型: '单选',
        题干: '已知函数 y=x^2+2x+1，下列说法正确的是？',
        选项A: '最小值为0',
        选项B: '最大值为0',
        选项C: '有两个不同零点',
        选项D: '在R上单调递减',
        答案: 'A',
        解析: 'y=(x+1)^2，最小值为0',
        难度: '中等',
        知识点: '函数;二次函数',
      },
      {
        科目: '英语',
        题型: '填空',
        题干: 'He ____ to school every day.',
        选项A: '',
        选项B: '',
        选项C: '',
        选项D: '',
        答案: 'goes',
        解析: '第三人称单数用 goes',
        难度: '简单',
        知识点: '一般现在时',
      },
    ]
    const sheet = XLSX.utils.json_to_sheet(exampleRows, { header: excelTemplateHeaders })
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, '题库模板')
    XLSX.writeFile(workbook, 'question_import_template.xlsx')
    message.success('模板已下载')
  }

  const parseExcel = async (file: File) => {
    const buffer = await file.arrayBuffer()
    const workbook = XLSX.read(buffer, { type: 'array' })
    const firstSheetName = workbook.SheetNames[0]
    if (!firstSheetName) {
      message.error('Excel 文件为空')
      return
    }
    const sheet = workbook.Sheets[firstSheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' })
    const errors: string[] = []
    const validRows: QuestionListItem[] = []
    const payloadRows: ImportPayloadRow[] = []

    rawRows.forEach((row, index) => {
      const rowNo = index + 2
      const type = String(row['题型'] ?? '').trim()
      const stem = String(row['题干'] ?? '').trim()
      const answer = String(row['答案'] ?? '').trim()
      const difficulty = String(row['难度'] ?? '').trim() || '中等'
      const optionA = String(row['选项A'] ?? '').trim()
      const optionB = String(row['选项B'] ?? '').trim()
      const optionC = String(row['选项C'] ?? '').trim()
      const optionD = String(row['选项D'] ?? '').trim()
      const subject = String(row['科目'] ?? '').trim()
      const explanation = String(row['解析'] ?? '').trim()
      const knowledgeText = String(row['知识点'] ?? '').trim()

      if (!validQuestionTypes.has(type)) {
        errors.push(`第 ${rowNo} 行：题型非法（${type || '空'}）`)
        return
      }
      if (!subject) {
        errors.push(`第 ${rowNo} 行：科目不能为空`)
        return
      }
      if (!stem) {
        errors.push(`第 ${rowNo} 行：题干不能为空`)
        return
      }
      if (!answer) {
        errors.push(`第 ${rowNo} 行：答案不能为空`)
        return
      }
      if (!validDifficulties.has(difficulty)) {
        errors.push(`第 ${rowNo} 行：难度必须是 简单/中等/困难`)
        return
      }
      if ((type === '单选' || type === '多选') && (!optionA || !optionB)) {
        errors.push(`第 ${rowNo} 行：选择题至少需要选项A和选项B`)
        return
      }

      validRows.push({
        key: `import-${Date.now()}-${index}`,
        id: 0,
        type,
        content: stem.slice(0, 50),
        difficulty,
        updatedAt: new Date().toISOString().slice(0, 10),
      })
      payloadRows.push({
        subject,
        type,
        stem,
        optionA,
        optionB,
        optionC,
        optionD,
        answer,
        explanation,
        difficulty,
        knowledgePoints: knowledgeText
          ? knowledgeText
              .split(';')
              .map((item) => item.trim())
              .filter(Boolean)
          : [],
      })
    })

    setImportPreviewRows(validRows)
    setImportPayloadRows(payloadRows)
    setImportErrors(errors)
  }

  const uploadProps: UploadProps = {
    accept: '.xlsx,.xls',
    maxCount: 1,
    beforeUpload: () => false,
    fileList,
    onChange: async ({ fileList: nextFileList }) => {
      setFileList(nextFileList)
      const raw = nextFileList[0]?.originFileObj
      if (raw) {
        await parseExcel(raw)
      } else {
        setImportPreviewRows([])
        setImportPayloadRows([])
        setImportErrors([])
      }
    },
  }

  const applyImportRows = async () => {
    if (importPreviewRows.length === 0) {
      message.warning('暂无可导入数据')
      return
    }
    if (!CAN_USE_API) {
      message.error('未配置 VITE_API_BASE_URL，无法调用后端导入接口')
      return
    }
    try {
      setImportSubmitting(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ rows: importPayloadRows }),
      })
      if (!response.ok) {
        if (response.status === 401) throw new Error('登录已过期，请重新登录')
        throw new Error(`导入接口失败(${response.status})`)
      }
      const payload = await response.json()
      const imported = Number(payload?.data?.success_rows ?? importPayloadRows.length)
      message.success(`成功导入 ${imported} 道题`)
      setOpenImport(false)
      setFileList([])
      setImportPreviewRows([])
      setImportPayloadRows([])
      setImportErrors([])
      await loadQuestionList()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      setImportSubmitting(false)
    }
  }

  const submitCreateQuestion = async () => {
    if (!CAN_USE_API) {
      message.error('未配置 VITE_API_BASE_URL，无法新增题目')
      return
    }
    try {
      const values = await createForm.validateFields()
      const type = String(values.type || '').trim()
      const rawAnswer = String(values.answer || '').trim()
      let normalizedAnswer = rawAnswer
      if (type === 'judge') {
        normalizedAnswer =
          rawAnswer === '对'
            ? 'A'
            : rawAnswer === '错'
              ? 'B'
              : rawAnswer.toUpperCase()
      } else if (type === 'single') {
        normalizedAnswer = rawAnswer.toUpperCase()
      } else if (type === 'multiple') {
        const picked = Array.from(new Set(
          rawAnswer
            .replace(/，/g, ',')
            .split(',')
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
        ))
        normalizedAnswer = picked.join(',')
      }
      const payload = {
        subject: String(values.subject || '').trim(),
        type,
        stem: String(values.stem || '').trim(),
        optionA: String(values.optionA || '').trim(),
        optionB: String(values.optionB || '').trim(),
        optionC: String(values.optionC || '').trim(),
        optionD: String(values.optionD || '').trim(),
        answer: normalizedAnswer,
        explanation: String(values.explanation || '').trim(),
        difficulty: String(values.difficulty || '中等').trim(),
        knowledgePoints: Array.isArray(values.knowledgePoints) ? values.knowledgePoints.map((item: unknown) => String(item).trim()).filter(Boolean) : [],
      }
      const endpoint = editingQuestionId ? `${API_BASE_URL}/api/questions/${editingQuestionId}` : `${API_BASE_URL}/api/questions`
      const response = await fetch(endpoint, {
        method: editingQuestionId ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.message || `${editingQuestionId ? '编辑' : '新增'}失败(${response.status})`)
      message.success(editingQuestionId ? '题目编辑成功' : '题目新增成功')
      setOpenDrawer(false)
      setEditingQuestionId(null)
      createForm.resetFields()
      await loadQuestionList()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新增题目失败')
    }
  }

  const openCreateDrawer = () => {
    setEditingQuestionId(null)
    createForm.resetFields()
    createForm.setFieldsValue({ type: 'single', difficulty: '中等', knowledgePoints: [], optionA: '', optionB: '', optionC: '', optionD: '' })
    setOpenDrawer(true)
  }

  const openEditDrawer = async (id: number) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/questions/${id}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载题目详情失败(${response.status})`)
      const detail = payload?.data || {}
      const apiType = Number(detail.type || 0)
      const type = apiType === 1 ? 'single' : apiType === 2 ? 'multiple' : apiType === 3 ? 'judge' : apiType === 4 ? 'fill' : 'short'
      const options = Array.isArray(detail.options) ? detail.options : []
      const optionMap: Record<string, string> = {}
      options.forEach((item: Record<string, unknown>) => {
        const key = String(item.option_key || '').toUpperCase()
        optionMap[key] = String(item.option_text || '')
      })
      setEditingQuestionId(id)
      setOpenDrawer(true)
      createForm.setFieldsValue({
        subject: String(detail.subject || ''),
        type,
        stem: String(detail.stem || ''),
        optionA: optionMap.A || '',
        optionB: optionMap.B || '',
        optionC: optionMap.C || '',
        optionD: optionMap.D || '',
        answer: String(detail.answer || ''),
        explanation: String(detail.explanation || ''),
        difficulty: mapDifficultyFromApi(detail.difficulty as string | number),
        knowledgePoints: Array.isArray(detail.knowledgePoints) ? detail.knowledgePoints : [],
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载题目详情失败')
    }
  }

  const deleteQuestion = async (id: number) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/questions/${id}`, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `删除题目失败(${response.status})`)
      message.success('题目删除成功')
      await loadQuestionList()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除题目失败')
    }
  }

  const loadDuplicateRows = async (markStatus?: string) => {
    if (!CAN_USE_API) return
    try {
      setDuplicateLoading(true)
      const params = new URLSearchParams()
      if (markStatus) params.set('markStatus', markStatus)
      const response = await fetch(`${API_BASE_URL}/api/question-duplicates?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载重复题失败(${response.status})`)
      const rows = Array.isArray(payload?.data) ? payload.data : []
      setDuplicateRows(
        rows.map((item: Record<string, unknown>, index: number) => ({
          key: `${String(item.question_id || index)}-${String(item.duplicate_group_key || '')}`,
          question_id: Number(item.question_id || 0),
          subject_name: String(item.subject_name || ''),
          question_type_text: String(item.question_type_text || ''),
          stem: String(item.stem || ''),
          updated_at: String(item.updated_at || ''),
          duplicate_count: Number(item.duplicate_count || 0),
          duplicate_group_key: String(item.duplicate_group_key || ''),
          mark_status: String(item.mark_status || 'pending'),
          note: String(item.note || ''),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载重复题失败')
    } finally {
      setDuplicateLoading(false)
    }
  }

  const markDuplicateQuestion = async (questionId: number, markStatus: 'pending' | 'marked' | 'ignored') => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/question-duplicates/mark`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ questionIds: [questionId], markStatus }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `标记失败(${response.status})`)
      message.success('重复题标记已更新')
      await loadDuplicateRows(duplicateStatusFilter)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重复题标记失败')
    }
  }

  const loadRecycleRows = async () => {
    if (!CAN_USE_API) return
    try {
      setRecycleLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/question-recycle-bin`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载回收站失败(${response.status})`)
      const rows = Array.isArray(payload?.data) ? payload.data : []
      setRecycleRows(
        rows.map((item: Record<string, unknown>, index: number) => ({
          key: String(item.id ?? `recycle-${index}`),
          id: Number(item.id || 0),
          subject_name: String(item.subject_name || ''),
          question_type_text: String(item.question_type_text || ''),
          stem: String(item.stem || ''),
          difficulty_text: String(item.difficulty_text || ''),
          deleted_at: String(item.deleted_at || ''),
        })),
      )
      setSelectedRecycleIds((prev) => prev.filter((id) => rows.some((row: Record<string, unknown>) => Number(row.id || 0) === id)))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载回收站失败')
    } finally {
      setRecycleLoading(false)
    }
  }

  const restoreQuestion = async (id: number) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/questions/${id}/restore`, {
        method: 'PATCH',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `恢复失败(${response.status})`)
      message.success('题目已恢复')
      await Promise.all([loadRecycleRows(), loadQuestionList()])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '恢复题目失败')
    }
  }

  const permanentDeleteQuestion = async (id: number) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/questions/${id}/permanent`, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `彻底删除失败(${response.status})`)
      message.success('题目已彻底删除')
      await loadRecycleRows()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '彻底删除失败')
    }
  }

  const openQuestionVersionHistory = async (id: number) => {
    if (!CAN_USE_API) return
    try {
      setVersionQuestionId(id)
      setOpenVersionHistory(true)
      setVersionLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/${id}/versions`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载版本历史失败(${response.status})`)
      const rows = Array.isArray(payload?.data) ? payload.data : []
      setVersionRows(
        rows.map((item: Record<string, unknown>, index: number) => ({
          key: String(item.id ?? `v-${index}`),
          id: Number(item.id || 0),
          action: String(item.action || ''),
          operator_name: String(item.operator_name || ''),
          created_at: String(item.created_at || ''),
          snapshot: item.snapshot && typeof item.snapshot === 'object' ? (item.snapshot as Record<string, unknown>) : {},
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载版本历史失败')
    } finally {
      setVersionLoading(false)
    }
  }

  const loadQualityAudit = async () => {
    if (!CAN_USE_API) return
    try {
      setQualityAuditLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/quality-audit`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `结构巡检失败(${response.status})`)
      const summary = Array.isArray(payload?.data?.summary) ? payload.data.summary : []
      const rows = Array.isArray(payload?.data?.rows) ? payload.data.rows : []
      setQualityAuditSummary(
        summary.map((item: Record<string, unknown>) => ({
          issue_code: String(item.issue_code || ''),
          issue_label: String(item.issue_label || ''),
          count: Number(item.count || 0),
        })),
      )
      setQualityAuditRows(
        rows.map((item: Record<string, unknown>, index: number) => ({
          key: `${String(item.question_id || index)}-${String(item.issue_code || '')}-${index}`,
          question_id: Number(item.question_id || 0),
          subject_name: String(item.subject_name || ''),
          question_type_text: String(item.question_type_text || ''),
          stem: String(item.stem || ''),
          issue_code: String(item.issue_code || ''),
          issue_label: String(item.issue_label || ''),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '结构巡检失败')
    } finally {
      setQualityAuditLoading(false)
    }
  }

  const fixQualityAuditIssues = async (issueCode?: string) => {
    if (!CAN_USE_API) return
    try {
      setQualityAuditFixing(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/quality-audit/fix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(issueCode ? { issueCode } : {}),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `自动修复失败(${response.status})`)
      const fixedCount = Number(payload?.data?.fixed_count || 0)
      message.success(`自动修复完成，已处理 ${fixedCount} 条`)
      await Promise.all([loadQualityAudit(), loadQuestionList()])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '自动修复失败')
    } finally {
      setQualityAuditFixing(false)
    }
  }

  const restoreQuestionVersion = async (questionId: number, versionId: number) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/questions/${questionId}/versions/${versionId}/restore`, {
        method: 'POST',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `版本回滚失败(${response.status})`)
      message.success('已回滚到指定版本')
      await Promise.all([openQuestionVersionHistory(questionId), loadQuestionList()])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '版本回滚失败')
    }
  }

  const batchRestoreRecycleQuestions = async () => {
    if (!CAN_USE_API || selectedRecycleIds.length === 0) return
    try {
      setRecycleSubmitting(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/recycle-bin/batch-restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ ids: selectedRecycleIds }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `批量恢复失败(${response.status})`)
      const successIds = Array.isArray(payload?.data?.success_ids) ? payload.data.success_ids : []
      const failedRows = Array.isArray(payload?.data?.failed) ? payload.data.failed : []
      if (failedRows.length > 0) {
        message.warning(`批量恢复完成：成功 ${successIds.length} 条，失败 ${failedRows.length} 条`)
      } else {
        message.success(`批量恢复成功：${successIds.length} 条`)
      }
      if (failedRows.length > 0) {
        Modal.info({
          title: '批量恢复失败明细',
          width: 620,
          content: (
            <List
              size="small"
              dataSource={failedRows.map((item: Record<string, unknown>) => `题目ID ${String(item.id)}：${String(item.reason || '恢复失败')}`) as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          ),
        })
      }
      setSelectedRecycleIds([])
      await Promise.all([loadRecycleRows(), loadQuestionList()])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量恢复失败')
    } finally {
      setRecycleSubmitting(false)
    }
  }

  const batchPermanentDeleteRecycleQuestions = async () => {
    if (!CAN_USE_API || selectedRecycleIds.length === 0) return
    try {
      setRecycleSubmitting(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/recycle-bin/batch-permanent-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ ids: selectedRecycleIds }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `批量彻底删除失败(${response.status})`)
      const successIds = Array.isArray(payload?.data?.success_ids) ? payload.data.success_ids : []
      const failedRows = Array.isArray(payload?.data?.failed) ? payload.data.failed : []
      if (failedRows.length > 0) {
        message.warning(`批量彻底删除完成：成功 ${successIds.length} 条，失败 ${failedRows.length} 条`)
      } else {
        message.success(`批量彻底删除成功：${successIds.length} 条`)
      }
      if (failedRows.length > 0) {
        Modal.info({
          title: '批量彻底删除失败明细',
          width: 620,
          content: (
            <List
              size="small"
              dataSource={failedRows.map((item: Record<string, unknown>) => `题目ID ${String(item.id)}：${String(item.reason || '删除失败')}`) as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          ),
        })
      }
      setSelectedRecycleIds([])
      await loadRecycleRows()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量彻底删除失败')
    } finally {
      setRecycleSubmitting(false)
    }
  }

  const openDuplicateMerge = (duplicateGroupKey: string, preferredKeepId: number) => {
    const sameGroupRows = duplicateRows.filter((item) => item.duplicate_group_key === duplicateGroupKey)
    if (sameGroupRows.length < 2) {
      message.warning('该分组当前不足2条题目，无法合并')
      return
    }
    setDuplicateMergeGroupKey(duplicateGroupKey)
    setDuplicateMergeRows(
      sameGroupRows.map((item) => ({
        question_id: item.question_id,
        stem: item.stem,
        question_type_text: item.question_type_text,
        updated_at: item.updated_at,
      })),
    )
    setDuplicateMergeKeepId(preferredKeepId)
    setDuplicateMergeOpen(true)
  }

  const submitDuplicateMerge = async () => {
    if (!CAN_USE_API || !duplicateMergeGroupKey || !duplicateMergeKeepId) {
      message.warning('请先选择保留题目')
      return
    }
    try {
      setDuplicateMergeLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/question-duplicates/merge-group`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          duplicateGroupKey: duplicateMergeGroupKey,
          keepQuestionId: duplicateMergeKeepId,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `重复题合并失败(${response.status})`)
      const mergedIds = Array.isArray(payload?.data?.merged_question_ids) ? payload.data.merged_question_ids : []
      message.success(`合并完成，保留题目 ${duplicateMergeKeepId}，合并 ${mergedIds.length} 条重复题`)
      setDuplicateMergeOpen(false)
      setDuplicateMergeGroupKey('')
      setDuplicateMergeKeepId(undefined)
      setDuplicateMergeRows([])
      await Promise.all([loadDuplicateRows(duplicateStatusFilter), loadQuestionList()])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '重复题合并失败')
    } finally {
      setDuplicateMergeLoading(false)
    }
  }

  const batchDeleteQuestions = async () => {
    if (!CAN_USE_API || selectedQuestionIds.length === 0) return
    try {
      setBatchSubmitting(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/batch-delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ ids: selectedQuestionIds }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `批量删除失败(${response.status})`)
      const successIds = Array.isArray(payload?.data?.success_ids) ? payload.data.success_ids : []
      const failedRows = Array.isArray(payload?.data?.failed) ? payload.data.failed : []
      if (failedRows.length > 0) {
        message.warning(`批量删除完成：成功 ${successIds.length} 条，失败 ${failedRows.length} 条`)
      } else {
        message.success(`批量删除成功：${successIds.length} 条`)
      }
      if (failedRows.length > 0) {
        Modal.info({
          title: '删除失败明细',
          width: 620,
          content: (
            <List
              size="small"
              dataSource={failedRows.map((item: Record<string, unknown>) => `题目ID ${String(item.id)}：${String(item.reason || '删除失败')}`) as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          ),
        })
      }
      setSelectedQuestionIds([])
      await loadQuestionList()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量删除失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  const submitBatchUpdate = async () => {
    if (!CAN_USE_API || selectedQuestionIds.length === 0) return
    try {
      const values = await batchForm.validateFields()
      const payload = {
        ids: selectedQuestionIds,
        subject: String(values.subject || '').trim(),
        difficulty: String(values.difficulty || '').trim(),
        addKnowledgePoints: Array.isArray(values.addKnowledgePoints) ? values.addKnowledgePoints : [],
        removeKnowledgePoints: Array.isArray(values.removeKnowledgePoints) ? values.removeKnowledgePoints : [],
      }
      if (!payload.subject && !payload.difficulty && payload.addKnowledgePoints.length === 0 && payload.removeKnowledgePoints.length === 0) {
        message.warning('请至少设置一个批量修改项')
        return
      }
      setBatchSubmitting(true)
      const response = await fetch(`${API_BASE_URL}/api/questions/batch-attrs`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.message || `批量更新失败(${response.status})`)
      const successIds = Array.isArray(result?.data?.success_ids) ? result.data.success_ids : []
      const failedRows = Array.isArray(result?.data?.failed) ? result.data.failed : []
      if (failedRows.length > 0) {
        message.warning(`批量修改完成：成功 ${successIds.length} 条，失败 ${failedRows.length} 条`)
        Modal.info({
          title: '批量修改失败明细',
          width: 620,
          content: (
            <List
              size="small"
              dataSource={failedRows.map((item: Record<string, unknown>) => `题目ID ${String(item.id)}：${String(item.reason || '修改失败')}`) as string[]}
              renderItem={(item: string) => <List.Item>{item}</List.Item>}
            />
          ),
        })
      } else {
        message.success(`批量修改成功：${successIds.length} 条`)
      }
      setOpenBatchUpdate(false)
      batchForm.resetFields()
      setSelectedQuestionIds([])
      await loadQuestionList()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '批量修改失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  return (
    <Card
      title="题库中心"
      extra={
        <Space>
          <Button onClick={downloadTemplate}>下载模板</Button>
          <Button onClick={() => setOpenImport(true)}>批量导入</Button>
          <Button
            onClick={() => {
              setOpenQualityAudit(true)
              void loadQualityAudit()
            }}
          >
            结构巡检
          </Button>
          <Button
            onClick={() => {
              setOpenRecycleBin(true)
              void loadRecycleRows()
            }}
          >
            回收站
          </Button>
          <Button
            onClick={() => {
              setOpenDuplicateCheck(true)
              void loadDuplicateRows(duplicateStatusFilter)
            }}
          >
            重复题检测
          </Button>
          <Button
            disabled={selectedQuestionIds.length === 0}
            onClick={() => {
              batchForm.resetFields()
              setOpenBatchUpdate(true)
            }}
          >
            批量修改属性
          </Button>
          <Popconfirm
            title={`确认批量删除已选 ${selectedQuestionIds.length} 道题目？`}
            okText="删除"
            cancelText="取消"
            onConfirm={() => void batchDeleteQuestions()}
            disabled={selectedQuestionIds.length === 0}
          >
            <Button danger disabled={selectedQuestionIds.length === 0} loading={batchSubmitting}>
              批量删除
            </Button>
          </Popconfirm>
          <Button onClick={() => void loadQuestionList()}>刷新题库</Button>
          <Button onClick={() => setOpenPreview(true)}>预览题目</Button>
          <Button type="primary" onClick={openCreateDrawer}>
            新增题目
          </Button>
        </Space>
      }
    >
      <Form layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item label="科目">
          <Select
            value={subjectFilter}
            style={{ width: 140 }}
            allowClear
            options={[{ value: 'math', label: '数学' }, { value: 'english', label: '英语' }]}
            onChange={(value) => setSubjectFilter(value)}
          />
        </Form.Item>
        <Form.Item label="题型">
          <Select
            style={{ width: 140 }}
            allowClear
            options={[{ value: 'single', label: '单选' }, { value: 'fill', label: '填空' }]}
            onChange={(value) => setTypeFilter(value)}
          />
        </Form.Item>
        <Form.Item label="知识点">
          <Input placeholder="函数 / 概率" />
        </Form.Item>
        <Form.Item>
          <Input.Search
            placeholder="题干关键词模糊搜索"
            allowClear
            value={keywordFilter}
            onChange={(e) => setKeywordFilter(e.target.value)}
            onSearch={(value) => {
              setKeywordFilter(value)
              void loadQuestionList({ keyword: value, page: 1 })
            }}
          />
        </Form.Item>
        <Form.Item>
          <Button type="primary" onClick={() => void loadQuestionList({ page: 1 })}>
            查询
          </Button>
        </Form.Item>
        <Form.Item>
          <Button
            onClick={() => {
              setSubjectFilter(undefined)
              setTypeFilter(undefined)
              setKeywordFilter('')
              setQuestionListPage(1)
              void loadQuestionList({ subject: '', type: '', keyword: '', page: 1, pageSize: questionListPageSize })
            }}
          >
            重置筛选
          </Button>
        </Form.Item>
      </Form>
      <Table
        columns={[
          ...questionColumns,
          {
            title: '操作',
            key: 'action',
            width: 160,
            render: (_: unknown, row: QuestionListItem) => (
              <Space>
                <Button type="link" onClick={() => void openEditDrawer(row.id)}>
                  编辑
                </Button>
                <Button type="link" onClick={() => void openQuestionVersionHistory(row.id)}>
                  历史
                </Button>
                <Popconfirm title="确认删除该题目？" okText="删除" cancelText="取消" onConfirm={() => void deleteQuestion(row.id)}>
                  <Button type="link" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        dataSource={questionRows}
        loading={tableLoading}
        rowSelection={{
          selectedRowKeys: selectedQuestionIds.map((id) => String(id)),
          onChange: (selectedRowKeys) => {
            setSelectedQuestionIds(selectedRowKeys.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))
          },
        }}
        pagination={{
          current: questionListPage,
          pageSize: questionListPageSize,
          total: questionListTotal,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (p, ps) => {
            setQuestionListPage(p)
            setQuestionListPageSize(ps)
            void loadQuestionList({ page: p, pageSize: ps })
          },
        }}
        locale={{ emptyText: <Empty description="暂无题目数据（可先导入）" /> }}
      />
      <Modal
        title="题库结构巡检结果"
        open={openQualityAudit}
        onCancel={() => setOpenQualityAudit(false)}
        footer={null}
        width={1080}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Row gutter={12}>
            {qualityAuditSummary.map((item) => (
              <Col span={6} key={item.issue_code}>
                <Card size="small">
                  <Statistic title={item.issue_label} value={item.count} />
                </Card>
              </Col>
            ))}
          </Row>
          <Space>
            <Select
              allowClear
              placeholder="问题类型筛选"
              style={{ width: 240 }}
              value={qualityAuditIssueFilter}
              onChange={(value) => setQualityAuditIssueFilter(value)}
              options={qualityAuditSummary.map((item) => ({ value: item.issue_code, label: item.issue_label }))}
            />
            <Button onClick={() => setQualityAuditIssueFilter(undefined)}>重置</Button>
            <Button
              type="primary"
              loading={qualityAuditFixing}
              disabled={!qualityAuditIssueFilter || !['missing_options', 'answer_not_in_options', 'invalid_multi_answer'].includes(qualityAuditIssueFilter)}
              onClick={() => void fixQualityAuditIssues(qualityAuditIssueFilter)}
            >
              修复当前类型
            </Button>
            <Button loading={qualityAuditFixing} onClick={() => void fixQualityAuditIssues()}>
              一键修复可修复项
            </Button>
          </Space>
          <Table
            size="small"
            loading={qualityAuditLoading}
            dataSource={qualityAuditRows.filter((item) => (qualityAuditIssueFilter ? item.issue_code === qualityAuditIssueFilter : true))}
            pagination={{ pageSize: 8 }}
            columns={[
              { title: '题目ID', dataIndex: 'question_id', width: 90 },
              { title: '科目', dataIndex: 'subject_name', width: 100 },
              { title: '题型', dataIndex: 'question_type_text', width: 90 },
              { title: '问题类型', dataIndex: 'issue_label', width: 200 },
              { title: '题干', dataIndex: 'stem', ellipsis: true },
              {
                title: '定位',
                key: 'locate',
                width: 100,
                render: (_: unknown, row: { question_id: number }) => (
                  <Button type="link" onClick={() => void openEditDrawer(row.question_id)}>
                    去编辑
                  </Button>
                ),
              },
            ]}
            locale={{ emptyText: '暂无结构问题' }}
          />
        </Space>
      </Modal>

      <Modal
        title={`题目版本历史${versionQuestionId ? `（ID ${versionQuestionId}）` : ''}`}
        open={openVersionHistory}
        onCancel={() => setOpenVersionHistory(false)}
        footer={null}
        width={980}
      >
        <Table
          size="small"
          loading={versionLoading}
          dataSource={versionRows}
          pagination={{ pageSize: 8 }}
          columns={[
            {
              title: '版本动作',
              dataIndex: 'action',
              width: 120,
              render: (value: string) => {
                if (value === 'create') return '新建'
                if (value === 'update') return '编辑'
                if (value === 'batch_update') return '批量修改'
                if (value === 'soft_delete') return '软删除'
                if (value === 'restore') return '恢复'
                return value || '-'
              },
            },
            { title: '操作人', dataIndex: 'operator_name', width: 120, render: (v: string) => v || '-' },
            { title: '时间', dataIndex: 'created_at', width: 180, render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '-') },
            {
              title: '版本快照',
              dataIndex: 'snapshot',
              render: (snapshot: Record<string, unknown>) => (
                <Space direction="vertical" size={2}>
                  <Typography.Text type="secondary">科目：{String(snapshot.subject_name || '-')}</Typography.Text>
                  <Typography.Text type="secondary">题型：{mapQuestionTypeFromApi(snapshot.question_type as string | number)}</Typography.Text>
                  <Typography.Text type="secondary">难度：{mapDifficultyFromApi(snapshot.difficulty as string | number)}</Typography.Text>
                  <Typography.Text>题干：{String(snapshot.stem || '-')}</Typography.Text>
                </Space>
              ),
            },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_: unknown, row: { id: number }) => (
                <Popconfirm
                  title="确认回滚到该版本？"
                  description="将覆盖当前题目内容（题干/选项/答案/解析/难度/知识点）"
                  okText="回滚"
                  cancelText="取消"
                  onConfirm={() => {
                    if (versionQuestionId) void restoreQuestionVersion(versionQuestionId, row.id)
                  }}
                >
                  <Button size="small" type="link">
                    一键回滚
                  </Button>
                </Popconfirm>
              ),
            },
          ]}
          locale={{ emptyText: '暂无版本历史' }}
        />
      </Modal>

      <Modal
        title="题库回收站"
        open={openRecycleBin}
        onCancel={() => setOpenRecycleBin(false)}
        footer={null}
        width={980}
      >
        <Space style={{ marginBottom: 12 }}>
          <Button disabled={selectedRecycleIds.length === 0} loading={recycleSubmitting} onClick={() => void batchRestoreRecycleQuestions()}>
            批量恢复
          </Button>
          <Popconfirm
            title={`确认彻底删除已选 ${selectedRecycleIds.length} 道题目？此操作不可恢复`}
            okText="删除"
            cancelText="取消"
            disabled={selectedRecycleIds.length === 0}
            onConfirm={() => void batchPermanentDeleteRecycleQuestions()}
          >
            <Button danger disabled={selectedRecycleIds.length === 0} loading={recycleSubmitting}>
              批量彻底删除
            </Button>
          </Popconfirm>
        </Space>
        <Table
          size="small"
          loading={recycleLoading}
          dataSource={recycleRows}
          rowSelection={{
            selectedRowKeys: selectedRecycleIds.map((id) => String(id)),
            onChange: (selectedRowKeys) => {
              setSelectedRecycleIds(selectedRowKeys.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0))
            },
          }}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '题目ID', dataIndex: 'id', width: 90 },
            { title: '科目', dataIndex: 'subject_name', width: 100 },
            { title: '题型', dataIndex: 'question_type_text', width: 90 },
            { title: '题干', dataIndex: 'stem', ellipsis: true },
            { title: '难度', dataIndex: 'difficulty_text', width: 90 },
            { title: '删除时间', dataIndex: 'deleted_at', width: 170, render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '-') },
            {
              title: '操作',
              key: 'action',
              width: 170,
              render: (_: unknown, row: { id: number }) => (
                <Space size={4}>
                  <Button size="small" type="link" onClick={() => void restoreQuestion(row.id)}>
                    恢复
                  </Button>
                  <Popconfirm title="确认彻底删除该题目？此操作不可恢复" okText="删除" cancelText="取消" onConfirm={() => void permanentDeleteQuestion(row.id)}>
                    <Button size="small" type="link" danger>
                      彻底删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
          locale={{ emptyText: '回收站暂无题目' }}
        />
      </Modal>

      <Modal
        title="重复题检测与标记"
        width={980}
        open={openDuplicateCheck}
        onCancel={() => setOpenDuplicateCheck(false)}
        footer={null}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Space>
            <Select
              allowClear
              placeholder="标记状态"
              style={{ width: 180 }}
              value={duplicateStatusFilter}
              onChange={(value) => setDuplicateStatusFilter(value)}
              options={[
                { value: 'pending', label: '待处理' },
                { value: 'marked', label: '已标记' },
                { value: 'ignored', label: '已忽略' },
              ]}
            />
            <Button onClick={() => void loadDuplicateRows(duplicateStatusFilter)}>查询</Button>
            <Button
              onClick={() => {
                setDuplicateStatusFilter(undefined)
                void loadDuplicateRows(undefined)
              }}
            >
              重置
            </Button>
          </Space>
          <Table
            size="small"
            loading={duplicateLoading}
            dataSource={duplicateRows}
            pagination={{ pageSize: 8 }}
            columns={[
              { title: '分组', dataIndex: 'duplicate_group_key', width: 120, render: (value: string) => value.slice(0, 8) },
              { title: '组内重复数', dataIndex: 'duplicate_count', width: 110 },
              { title: '题目ID', dataIndex: 'question_id', width: 90 },
              { title: '科目', dataIndex: 'subject_name', width: 100 },
              { title: '题型', dataIndex: 'question_type_text', width: 90 },
              { title: '题干', dataIndex: 'stem', ellipsis: true },
              {
                title: '标记状态',
                dataIndex: 'mark_status',
                width: 100,
                render: (value: string) =>
                  value === 'marked' ? <Tag color="processing">已标记</Tag> : value === 'ignored' ? <Tag>已忽略</Tag> : <Tag color="warning">待处理</Tag>,
              },
              {
                title: '操作',
                key: 'action',
                width: 260,
                render: (_: unknown, row: { question_id: number; duplicate_group_key: string }) => (
                  <Space size={4}>
                    <Button size="small" type="link" onClick={() => void markDuplicateQuestion(row.question_id, 'marked')}>
                      标记
                    </Button>
                    <Button size="small" type="link" onClick={() => void markDuplicateQuestion(row.question_id, 'ignored')}>
                      忽略
                    </Button>
                    <Button size="small" type="link" onClick={() => void markDuplicateQuestion(row.question_id, 'pending')}>
                      还原
                    </Button>
                    <Button
                      size="small"
                      type="link"
                      onClick={() => openDuplicateMerge(row.duplicate_group_key, row.question_id)}
                    >
                      单组合并
                    </Button>
                  </Space>
                ),
              },
            ]}
            locale={{ emptyText: '暂无重复题' }}
          />
        </Space>
      </Modal>
      <Modal
        title="单组合并重复题"
        open={duplicateMergeOpen}
        onCancel={() => setDuplicateMergeOpen(false)}
        onOk={() => void submitDuplicateMerge()}
        confirmLoading={duplicateMergeLoading}
        okText="确认合并"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Text type="secondary">请选择要保留的题目，其他同组题目将自动迁移引用后删除。</Typography.Text>
          <Select
            value={duplicateMergeKeepId}
            onChange={(value) => setDuplicateMergeKeepId(value)}
            options={duplicateMergeRows.map((item) => ({
              value: item.question_id,
              label: `ID${item.question_id}｜${item.question_type_text}｜${item.stem.slice(0, 24)}${item.stem.length > 24 ? '...' : ''}`,
            }))}
            placeholder="请选择保留题目"
          />
          <List
            size="small"
            dataSource={duplicateMergeRows.map((item) => `ID ${item.question_id}｜${item.question_type_text}｜${item.updated_at ? item.updated_at.slice(0, 10) : '-'}｜${item.stem}`)}
            renderItem={(item: string) => <List.Item>{item}</List.Item>}
          />
        </Space>
      </Modal>

      <Modal
        title={`批量修改题目属性（已选 ${selectedQuestionIds.length} 道）`}
        open={openBatchUpdate}
        onCancel={() => setOpenBatchUpdate(false)}
        onOk={() => void submitBatchUpdate()}
        confirmLoading={batchSubmitting}
      >
        <Form form={batchForm} layout="vertical">
          <Form.Item label="批量修改科目" name="subject">
            <Select allowClear placeholder="不修改请留空" options={subjectOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label="批量修改难度" name="difficulty">
            <Select
              allowClear
              placeholder="不修改请留空"
              options={[
                { value: '简单', label: '简单' },
                { value: '中等', label: '中等' },
                { value: '困难', label: '困难' },
              ]}
            />
          </Form.Item>
          <Form.Item label="批量新增知识点标签" name="addKnowledgePoints">
            <Select mode="tags" placeholder="输入后回车，可留空" />
          </Form.Item>
          <Form.Item label="批量移除知识点标签" name="removeKnowledgePoints">
            <Select mode="tags" placeholder="输入后回车，可留空" />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={editingQuestionId ? '编辑题目' : '新增题目'}
        width={560}
        open={openDrawer}
        onClose={() => {
          setOpenDrawer(false)
          setEditingQuestionId(null)
        }}
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ type: 'single', difficulty: '中等', knowledgePoints: [], optionA: '', optionB: '', optionC: '', optionD: '' }}
          onValuesChange={(changedValues) => {
            if (!Object.prototype.hasOwnProperty.call(changedValues, 'type')) return
            const nextType = changedValues.type
            if (nextType === 'judge') {
              createForm.setFieldsValue({
                optionA: '对',
                optionB: '错',
                optionC: '',
                optionD: '',
                answer: undefined,
              })
              return
            }
            createForm.setFieldsValue({
              optionA: '',
              optionB: '',
              optionC: '',
              optionD: '',
              answer: undefined,
            })
          }}
        >
          <Form.Item label="科目" name="subject" rules={[{ required: true, message: '请选择科目' }]}>
            <Select
              placeholder="请选择科目"
              options={subjectOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item label="题型" name="type" rules={[{ required: true, message: '请选择题型' }]}>
            <Select
              options={[{ value: 'single', label: '单选' }, { value: 'multiple', label: '多选' }, { value: 'judge', label: '判断' }, { value: 'fill', label: '填空' }, { value: 'short', label: '简答' }]}
            />
          </Form.Item>
          <Form.Item label="题干（富文本占位）" name="stem" rules={[{ required: true, message: '请输入题干' }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.type !== cur.type}>
            {({ getFieldValue }) => {
              const type = getFieldValue('type')
              if (type !== 'single' && type !== 'multiple' && type !== 'judge') return null
              return (
                <>
                  <Form.Item label="选项A" name="optionA" rules={[{ required: true, message: '请输入选项A' }]}>
                    <Input disabled={type === 'judge'} />
                  </Form.Item>
                  <Form.Item label="选项B" name="optionB" rules={[{ required: true, message: '请输入选项B' }]}>
                    <Input disabled={type === 'judge'} />
                  </Form.Item>
                  <Form.Item label="选项C" name="optionC">
                    <Input />
                  </Form.Item>
                  <Form.Item label="选项D" name="optionD">
                    <Input />
                  </Form.Item>
                </>
              )
            }}
          </Form.Item>
          <Form.Item
            noStyle
            shouldUpdate={(prev, cur) => prev.type !== cur.type}
          >
            {({ getFieldValue }) => {
              const type = getFieldValue('type')
              return (
                <Form.Item
                  label="正确答案"
                  name="answer"
                  rules={[
                    { required: true, message: '请选择或输入正确答案' },
                    {
                      validator: (_, value) => {
                        const answer = String(value || '').trim()
                        const optionA = String(createForm.getFieldValue('optionA') || '').trim()
                        const optionB = String(createForm.getFieldValue('optionB') || '').trim()
                        const optionC = String(createForm.getFieldValue('optionC') || '').trim()
                        const optionD = String(createForm.getFieldValue('optionD') || '').trim()
                        const availableOptions = new Set<string>([
                          ...(optionA ? ['A'] : []),
                          ...(optionB ? ['B'] : []),
                          ...(optionC ? ['C'] : []),
                          ...(optionD ? ['D'] : []),
                        ])
                        if (!answer) return Promise.resolve()
                        if (type === 'judge' && !['A', 'B', '对', '错'].includes(answer)) {
                          return Promise.reject(new Error('判断题答案仅支持 A/B 或 对/错'))
                        }
                        if (type === 'single') {
                          const normalized = answer.toUpperCase()
                          if (!['A', 'B', 'C', 'D'].includes(normalized)) {
                            return Promise.reject(new Error('单选题答案仅支持 A/B/C/D'))
                          }
                          if (!availableOptions.has(normalized)) {
                            return Promise.reject(new Error('单选题答案必须落在已填写选项内'))
                          }
                        }
                        if (type === 'multiple') {
                          const picked = Array.from(
                            new Set(
                              answer
                                .replace(/，/g, ',')
                                .split(',')
                                .map((item) => item.trim().toUpperCase())
                                .filter(Boolean),
                            ),
                          )
                          if (picked.length < 2) {
                            return Promise.reject(new Error('多选题答案至少选择2个选项，例如 A,C'))
                          }
                          if (picked.some((item) => !['A', 'B', 'C', 'D'].includes(item))) {
                            return Promise.reject(new Error('多选题答案仅支持 A/B/C/D，使用逗号分隔'))
                          }
                          if (picked.some((item) => !availableOptions.has(item))) {
                            return Promise.reject(new Error('多选题答案必须落在已填写选项内'))
                          }
                        }
                        return Promise.resolve()
                      },
                    },
                  ]}
                >
                  {type === 'judge' ? (
                    <Select
                      placeholder="请选择判断题答案"
                      options={[
                        { value: '对', label: '对（A）' },
                        { value: '错', label: '错（B）' },
                        { value: 'A', label: 'A（对）' },
                        { value: 'B', label: 'B（错）' },
                      ]}
                    />
                  ) : (
                    <Input placeholder={type === 'multiple' ? '多选示例：A,C' : '示例：A / goes / 公式结果'} />
                  )}
                </Form.Item>
              )
            }}
          </Form.Item>
          <Form.Item label="解析" name="explanation">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item label="难度" name="difficulty" rules={[{ required: true, message: '请选择难度' }]}>
            <Select options={[{ value: '简单', label: '简单' }, { value: '中等', label: '中等' }, { value: '困难', label: '困难' }]} />
          </Form.Item>
          <Form.Item label="知识点标签" name="knowledgePoints">
            <Select mode="tags" placeholder="输入后回车创建标签" />
          </Form.Item>
          <Button type="primary" block onClick={() => void submitCreateQuestion()}>
            {editingQuestionId ? '保存修改' : '保存题目'}
          </Button>
        </Form>
      </Drawer>

      <Modal
        open={openImport}
        title="批量导入题目"
        width={820}
        onCancel={() => setOpenImport(false)}
        onOk={applyImportRows}
        okText="确认导入正确行"
        confirmLoading={importSubmitting}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Typography.Paragraph>1) 先下载模板填充题目 2) 上传 Excel 3) 预览校验后导入正确行。</Typography.Paragraph>
          <Upload {...uploadProps}>
            <Button>选择 Excel 文件</Button>
          </Upload>
          <List
            size="small"
            dataSource={[
              `正确行数：${importPreviewRows.length}`,
              `错误行数：${importErrors.length}`,
            ]}
            renderItem={(item) => <List.Item>{item}</List.Item>}
          />
          {importErrors.length > 0 && (
            <Card title="导入错误明细" size="small">
              <List size="small" dataSource={importErrors.slice(0, 8)} renderItem={(item) => <List.Item>{item}</List.Item>} />
            </Card>
          )}
          <Card title="预览可导入数据" size="small">
            <Table
              columns={questionColumns}
              dataSource={importPreviewRows}
              pagination={{ pageSize: 5 }}
              locale={{ emptyText: '上传并校验后显示可导入行' }}
            />
          </Card>
        </Space>
      </Modal>

      <Modal open={openPreview} title="题目预览" onCancel={() => setOpenPreview(false)} onOk={() => setOpenPreview(false)}>
        <Typography.Title level={5}>题干</Typography.Title>
        <Typography.Paragraph>已知函数 f(x)=x^2+2x+1，下列说法正确的是...</Typography.Paragraph>
        <Typography.Title level={5}>解析</Typography.Title>
        <Typography.Paragraph>利用完全平方公式可得 f(x)=(x+1)^2 ...</Typography.Paragraph>
      </Modal>
    </Card>
  )
}

function ExamPage() {
  const getLocalDateTimeMin = () => {
    const now = new Date()
    now.setSeconds(0, 0)
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  }
  const toLocalDateTimeInput = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
    return date.toISOString().slice(0, 16)
  }
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const authUserRaw = localStorage.getItem(AUTH_USER_KEY)
  const authUser: AuthUser | null = useMemo(() => {
    if (!authUserRaw) return null
    try {
      return JSON.parse(authUserRaw) as AuthUser
    } catch {
      return null
    }
  }, [authUserRaw])
  const canCreateExam = Boolean(authUser?.roles?.some((role) => role === 'admin' || role === 'class_teacher' || role === 'subject_teacher'))
  const [openCreate, setOpenCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [editingExamId, setEditingExamId] = useState<number | null>(null)
  const [exams, setExams] = useState<
    Array<{
      key: string
      id: number
      title: string
      subject_name: string
      class_names: string[]
      start_time: string
      end_time: string
      status: number
      can_manage: boolean
      expected_count: number
      submitted_count: number
    }>
  >([])
  type ExamRow = {
    key: string
    id: number
    title: string
    subject_name: string
    class_names: string[]
    start_time: string
    end_time: string
    status: number
    can_manage: boolean
    expected_count: number
    submitted_count: number
  }
  const [classOptions, setClassOptions] = useState<Array<{ label: string; value: number }>>([])
  const [subjectOptions, setSubjectOptions] = useState<Array<{ label: string; value: number }>>([])
  const [questionOptions, setQuestionOptions] = useState<Array<{ key: string; id: number; type: string; stem: string; difficulty: string }>>([])
  const [questionKeyword, setQuestionKeyword] = useState('')
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<number[]>([])
  const [questionScoreMap, setQuestionScoreMap] = useState<Record<number, number>>({})
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | undefined>(undefined)
  const [dateTimeMin, setDateTimeMin] = useState(getLocalDateTimeMin())
  const [examDefaults, setExamDefaults] = useState({
    defaultDurationMinutes: 60,
    defaultQuestionScore: 1,
  })
  const [examTab, setExamTab] = useState<'pending' | 'active' | 'done'>('pending')
  const [examPage, setExamPage] = useState(1)
  const [examPageSize, setExamPageSize] = useState(20)
  const [examTotal, setExamTotal] = useState(0)
  const [form] = Form.useForm()
  const navigate = useNavigate()

  const examStatusByTab: Record<'pending' | 'active' | 'done', number> = { pending: 1, active: 2, done: 3 }

  const loadExams = async (opts?: { tab?: 'pending' | 'active' | 'done'; page?: number; pageSize?: number }) => {
    if (!CAN_USE_API) return
    const tab = opts?.tab ?? examTab
    const page = opts?.page ?? examPage
    const pageSize = opts?.pageSize ?? examPageSize
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.set('status', String(examStatusByTab[tab]))
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      params.set('manageableOnly', '1')
      const response = await fetch(`${API_BASE_URL}/api/exams?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 403) {
          setExams([])
          setExamTotal(0)
          setExamTab(tab)
          setExamPage(page)
          setExamPageSize(pageSize)
          return
        }
        throw new Error(payload?.message || `加载考试失败(${response.status})`)
      }
      setExamTab(tab)
      setExamPage(page)
      setExamPageSize(pageSize)
      setExamTotal(Number(payload?.pagination?.total ?? 0))
      setExams(
        (Array.isArray(payload?.data) ? payload.data : []).map((item: Record<string, unknown>) => ({
          key: String(item.id),
          id: Number(item.id),
          title: String(item.title ?? ''),
          subject_name: String(item.subject_name ?? ''),
          class_names: Array.isArray(item.class_names) ? (item.class_names as string[]) : [],
          start_time: String(item.start_time ?? ''),
          end_time: String(item.end_time ?? ''),
          status: Number(item.status ?? 1),
          can_manage: Boolean(item.can_manage),
          expected_count: Number(item.expected_count ?? 0),
          submitted_count: Number(item.submitted_count ?? 0),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载考试失败')
    } finally {
      setLoading(false)
    }
  }

  const loadInitOptions = async () => {
    if (!CAN_USE_API) return
    try {
      const [classRes, subjectRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/classes`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        }),
        fetch(`${API_BASE_URL}/api/subjects`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        }),
      ])
      const classPayload = await classRes.json().catch(() => ({}))
      const subjectPayload = await subjectRes.json().catch(() => ({}))
      const errs: string[] = []
      if (classRes.ok) {
        setClassOptions(
          (Array.isArray(classPayload?.data) ? classPayload.data : []).map((item: Record<string, unknown>) => ({
            label: String(item.name ?? ''),
            value: Number(item.id),
          })),
        )
      } else if (classRes.status === 403) {
        setClassOptions([])
      } else {
        errs.push(String(classPayload?.message || `加载班级失败(${classRes.status})`))
      }
      if (subjectRes.ok) {
        setSubjectOptions(
          (Array.isArray(subjectPayload?.data) ? subjectPayload.data : []).map((item: Record<string, unknown>) => ({
            label: String(item.name ?? ''),
            value: Number(item.id),
          })),
        )
      } else if (subjectRes.status === 403) {
        setSubjectOptions([])
      } else {
        errs.push(String(subjectPayload?.message || `加载科目失败(${subjectRes.status})`))
      }
      if (errs.length) throw new Error(errs.join('；'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载考试配置失败')
    }
  }

  const loadQuestions = async (subjectId?: number, keyword?: string) => {
    if (!CAN_USE_API) return
    try {
      const query = new URLSearchParams()
      if (subjectId) {
        const subject = subjectOptions.find((item) => item.value === subjectId)?.label
        if (subject) query.set('subject', subject)
      }
      if (keyword?.trim()) query.set('keyword', keyword.trim())
      const url = `${API_BASE_URL}/api/questions${query.toString() ? `?${query.toString()}` : ''}`
      const response = await fetch(url, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 403) {
          setQuestionOptions([])
          return
        }
        throw new Error(payload?.message || `加载题目失败(${response.status})`)
      }
      setQuestionOptions(
        (Array.isArray(payload?.data) ? payload.data : []).map((item: Record<string, unknown>) => ({
          key: String(item.id),
          id: Number(item.id),
          type: String(item.question_type_text ?? ''),
          stem: String(item.stem ?? ''),
          difficulty: String(item.difficulty_text ?? ''),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载题目失败')
    }
  }

  useEffect(() => {
    void loadExams({ tab: 'pending', page: 1, pageSize: 20 })
    void loadInitOptions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const loadExamDefaults = async () => {
      if (!CAN_USE_API) return
      try {
        const response = await fetch(`${API_BASE_URL}/api/system-configs/exam-default`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) return
        setExamDefaults({
          defaultDurationMinutes: Number(payload?.data?.defaultDurationMinutes || 60),
          defaultQuestionScore: Number(payload?.data?.defaultQuestionScore || 1),
        })
      } catch {
        // ignore config load failure, keep local defaults
      }
    }
    void loadExamDefaults()
  }, [authToken])

  useEffect(() => {
    if (!openCreate) return
    void loadQuestions(selectedSubjectId, questionKeyword)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreate, selectedSubjectId, questionKeyword, subjectOptions.length])

  const baseColumns: Array<Record<string, unknown>> = [
    {
      title: '考试名称',
      render: (_: unknown, row: ExamRow) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/exams/${row.id}`)}>
          {row.title}
        </Button>
      ),
    },
    { title: '科目', dataIndex: 'subject_name' },
    { title: '关联班级', render: (_: unknown, row: ExamRow) => row.class_names.join('、') || '-' },
    { title: '时间', render: (_: unknown, row: ExamRow) => `${row.start_time.slice(0, 16).replace('T', ' ')} ~ ${row.end_time.slice(0, 16).replace('T', ' ')}` },
    { title: '提交人数/应考人数', render: (_: unknown, row: ExamRow) => `${row.submitted_count}/${row.expected_count}` },
  ]
  const visibleQuestionIds = questionOptions.map((item) => item.id)
  const visibleSelectedCount = visibleQuestionIds.filter((id) => selectedQuestionIds.includes(id)).length
  const allVisibleSelected = visibleQuestionIds.length > 0 && visibleSelectedCount === visibleQuestionIds.length
  const visibleIndeterminate = visibleSelectedCount > 0 && visibleSelectedCount < visibleQuestionIds.length

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="考试管理"
        extra={
          canCreateExam ? (
            <Button
              type="primary"
              onClick={() => {
                setEditingExamId(null)
                setSelectedQuestionIds([])
                setQuestionScoreMap({})
                setSelectedSubjectId(undefined)
                setQuestionKeyword('')
                setDateTimeMin(getLocalDateTimeMin())
                form.resetFields()
                form.setFieldValue('duration', examDefaults.defaultDurationMinutes)
                setOpenCreate(true)
              }}
            >
              创建考试
            </Button>
          ) : null
        }
      >
        <Tabs
          destroyInactiveTabPane
          activeKey={examTab}
          onChange={(key) => {
            const k = key as 'pending' | 'active' | 'done'
            setExamPage(1)
            void loadExams({ tab: k, page: 1, pageSize: examPageSize })
          }}
          items={[
            {
              key: 'pending',
              label: '未开始',
              children: (
                <Table
                  loading={loading}
                  columns={[
                    ...baseColumns,
                    {
                      title: '操作',
                      key: 'action',
                      render: (_: unknown, row: { id: number; can_manage: boolean }) => {
                        if (!row.can_manage) return null
                        return (
                          <Space>
                            <Button
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}/copy`, {
                                    method: 'POST',
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `复制失败(${response.status})`)
                                  message.success('考试复制成功')
                                  await loadExams()
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '复制考试失败')
                                }
                              }}
                            >
                              复制
                            </Button>
                            <Button
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}`, {
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `加载失败(${response.status})`)
                                  const exam = payload?.data
                                  const questionIds: number[] = Array.isArray(exam?.questions)
                                    ? exam.questions.map((item: Record<string, unknown>) => Number(item.question_id)).filter((id: number) => !Number.isNaN(id))
                                    : []
                                  const nextScoreMap: Record<number, number> = {}
                                  ;(Array.isArray(exam?.questions) ? exam.questions : []).forEach((item: Record<string, unknown>) => {
                                    const qid = Number(item.question_id)
                                    const score = Number(item.score)
                                    if (!Number.isNaN(qid)) nextScoreMap[qid] = Number.isNaN(score) || score <= 0 ? 1 : score
                                  })
                                  setEditingExamId(row.id)
                                  setSelectedSubjectId(Number(exam?.subject_id))
                                  setSelectedQuestionIds(questionIds)
                                  setQuestionScoreMap(nextScoreMap)
                                  setDateTimeMin(getLocalDateTimeMin())
                                  form.setFieldsValue({
                                    title: String(exam?.title || ''),
                                    description: String(exam?.description || ''),
                                    subjectId: Number(exam?.subject_id),
                                    startTime: toLocalDateTimeInput(String(exam?.start_time || '')),
                                    endTime: toLocalDateTimeInput(String(exam?.end_time || '')),
                                    duration: Number(exam?.duration || 60),
                                    classIds: Array.isArray(exam?.classes)
                                      ? exam.classes.map((item: Record<string, unknown>) => Number(item.id)).filter((id: number) => !Number.isNaN(id))
                                      : [],
                                  })
                                  setOpenCreate(true)
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '加载考试信息失败')
                                }
                              }}
                            >
                              编辑
                            </Button>
                            <Button
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}/publish`, {
                                    method: 'PATCH',
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `发布失败(${response.status})`)
                                  message.success('考试发布成功')
                                  await loadExams()
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '发布考试失败')
                                }
                              }}
                            >
                              发布考试
                            </Button>
                            <Button
                              danger
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                const ok = window.confirm('确认删除该未开始考试吗？删除后不可恢复。')
                                if (!ok) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}`, {
                                    method: 'DELETE',
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `删除失败(${response.status})`)
                                  message.success('考试已删除')
                                  await loadExams()
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '删除考试失败')
                                }
                              }}
                            >
                              删除
                            </Button>
                          </Space>
                        )
                      },
                    },
                  ]}
                  dataSource={exams}
                  pagination={{
                    current: examPage,
                    pageSize: examPageSize,
                    total: examTotal,
                    showSizeChanger: true,
                    showTotal: (total) => `共 ${total} 条`,
                    onChange: (p, ps) => {
                      setExamPage(p)
                      setExamPageSize(ps)
                      void loadExams({ page: p, pageSize: ps })
                    },
                  }}
                />
              ),
            },
            {
              key: 'active',
              label: '进行中',
              children: (
                <Table
                  loading={loading}
                  columns={[
                    ...baseColumns,
                    {
                      title: '操作',
                      key: 'action',
                      render: (_: unknown, row: { id: number; can_manage: boolean }) => {
                        if (!row.can_manage) return null
                        return (
                          <Space>
                            <Button
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}/copy`, {
                                    method: 'POST',
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `复制失败(${response.status})`)
                                  message.success('考试复制成功')
                                  await loadExams()
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '复制考试失败')
                                }
                              }}
                            >
                              复制
                            </Button>
                            <Button
                              danger
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}/finish`, {
                                    method: 'PATCH',
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `提前结束失败(${response.status})`)
                                  message.success('考试已提前结束')
                                  await loadExams()
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '提前结束考试失败')
                                }
                              }}
                            >
                              提前结束
                            </Button>
                          </Space>
                        )
                      },
                    },
                  ]}
                  dataSource={exams}
                  pagination={{
                    current: examPage,
                    pageSize: examPageSize,
                    total: examTotal,
                    showSizeChanger: true,
                    showTotal: (total) => `共 ${total} 条`,
                    onChange: (p, ps) => {
                      setExamPage(p)
                      setExamPageSize(ps)
                      void loadExams({ page: p, pageSize: ps })
                    },
                  }}
                />
              ),
            },
            {
              key: 'done',
              label: '已结束',
              children: (
                <Table
                  loading={loading}
                  columns={[
                    ...baseColumns,
                    {
                      title: '操作',
                      key: 'action',
                      render: (_: unknown, row: { id: number; can_manage: boolean }) => {
                        if (!row.can_manage) return null
                        return (
                          <Space>
                            <Button
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}/copy`, {
                                    method: 'POST',
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `复制失败(${response.status})`)
                                  message.success('考试复制成功')
                                  await loadExams()
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '复制考试失败')
                                }
                              }}
                            >
                              复制
                            </Button>
                            <Button
                              type="link"
                              onClick={async () => {
                                if (!CAN_USE_API) return
                                try {
                                  const response = await fetch(`${API_BASE_URL}/api/exams/${row.id}/reopen`, {
                                    method: 'PATCH',
                                    headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                                  })
                                  const payload = await response.json().catch(() => ({}))
                                  if (!response.ok) throw new Error(payload?.message || `重新开启失败(${response.status})`)
                                  message.success('考试已重新开启')
                                  await loadExams()
                                } catch (error) {
                                  message.error(error instanceof Error ? error.message : '重新开启考试失败')
                                }
                              }}
                            >
                              再开启
                            </Button>
                          </Space>
                        )
                      },
                    },
                  ]}
                  dataSource={exams}
                  pagination={{
                    current: examPage,
                    pageSize: examPageSize,
                    total: examTotal,
                    showSizeChanger: true,
                    showTotal: (total) => `共 ${total} 条`,
                    onChange: (p, ps) => {
                      setExamPage(p)
                      setExamPageSize(ps)
                      void loadExams({ page: p, pageSize: ps })
                    },
                  }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editingExamId ? '编辑考试' : '创建考试'}
        open={openCreate}
        width={980}
        onCancel={() => {
          setOpenCreate(false)
          setEditingExamId(null)
        }}
        onOk={() => form.submit()}
        okButtonProps={{ loading: submitLoading }}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={async (values: {
            title: string
            description?: string
            subjectId: number
            startTime: string
            endTime: string
            duration: number
            classIds: number[]
          }) => {
            if (!CAN_USE_API) return
            if (selectedQuestionIds.length === 0) {
              message.warning('请至少选择一道题目')
              return
            }
            if (selectedQuestionIds.some((id) => !questionScoreMap[id] || questionScoreMap[id] <= 0)) {
              message.warning('请为已选题目设置大于0的分值')
              return
            }
            const now = new Date()
            const start = new Date(values.startTime)
            const end = new Date(values.endTime)
            if (Number.isNaN(start.getTime()) || start < now) {
              message.warning('开始时间不能早于当前时间')
              return
            }
            if (Number.isNaN(end.getTime()) || end <= start) {
              message.warning('结束时间必须晚于开始时间')
              return
            }
            try {
              setSubmitLoading(true)
              const response = await fetch(
                editingExamId ? `${API_BASE_URL}/api/exams/${editingExamId}` : `${API_BASE_URL}/api/exams`,
                {
                method: editingExamId ? 'PUT' : 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                },
                body: JSON.stringify({
                  ...values,
                  questionItems: selectedQuestionIds.map((questionId, index) => ({
                    questionId,
                    score: questionScoreMap[questionId] ?? examDefaults.defaultQuestionScore,
                    sortOrder: index + 1,
                  })),
                  startTime: new Date(values.startTime).toISOString(),
                  endTime: new Date(values.endTime).toISOString(),
                }),
                },
              )
              const payload = await response.json().catch(() => ({}))
              if (!response.ok) throw new Error(payload?.message || `${editingExamId ? '编辑' : '创建'}失败(${response.status})`)
              message.success(editingExamId ? '考试编辑成功' : '考试创建成功')
              setOpenCreate(false)
              setEditingExamId(null)
              await loadExams()
            } catch (error) {
              message.error(error instanceof Error ? error.message : `${editingExamId ? '编辑' : '创建'}考试失败`)
            } finally {
              setSubmitLoading(false)
            }
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="title" label="考试名称" rules={[{ required: true, message: '请输入考试名称' }]}>
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="subjectId" label="科目" rules={[{ required: true, message: '请选择科目' }]}>
                <Select
                  options={subjectOptions}
                  onChange={(value: number) => {
                    setSelectedSubjectId(value)
                    setSelectedQuestionIds([])
                    setQuestionScoreMap({})
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="startTime" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
                <Input type="datetime-local" min={dateTimeMin} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="endTime" label="结束时间" rules={[{ required: true, message: '请选择结束时间' }]}>
                <Input type="datetime-local" min={dateTimeMin} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="duration" label="答题时长（分钟）" rules={[{ required: true, message: '请输入答题时长' }]}>
                <Input type="number" min={1} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="classIds" label="关联班级" rules={[{ required: true, message: '请选择至少一个班级' }]}>
                <Select mode="multiple" options={classOptions} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="description" label="考试说明">
                <Input.TextArea rows={3} />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <Card
          title={`选题组卷（已选 ${selectedQuestionIds.length} 题，总分 ${selectedQuestionIds.reduce((sum, id) => sum + (questionScoreMap[id] ?? examDefaults.defaultQuestionScore), 0)}）`}
        >
          <Space style={{ marginBottom: 12 }}>
            <Input.Search
              value={questionKeyword}
              onChange={(event) => setQuestionKeyword(event.target.value)}
              onSearch={(value) => setQuestionKeyword(value)}
              placeholder="按题干关键词筛选"
              allowClear
              style={{ width: 280 }}
            />
            <Typography.Text type="secondary">仅展示当前科目题目</Typography.Text>
          </Space>
          <Table
            columns={[
              {
                title: (
                  <Checkbox
                    checked={allVisibleSelected}
                    indeterminate={visibleIndeterminate}
                    onChange={(event) => {
                      const checked = event.target.checked
                      if (checked) {
                        setSelectedQuestionIds((prev) => Array.from(new Set([...prev, ...visibleQuestionIds])))
                        setQuestionScoreMap((prev) => {
                          const next = { ...prev }
                          visibleQuestionIds.forEach((id) => {
                            if (!next[id]) next[id] = examDefaults.defaultQuestionScore
                          })
                          return next
                        })
                      } else {
                        setSelectedQuestionIds((prev) => prev.filter((id) => !visibleQuestionIds.includes(id)))
                      }
                    }}
                  >
                    全选
                  </Checkbox>
                ),
                key: 'pick',
                width: 140,
                render: (_: unknown, row: { id: number }) => {
                  return (
                    <Checkbox
                      checked={selectedQuestionIds.includes(row.id)}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setSelectedQuestionIds((prev) =>
                          checked ? Array.from(new Set([...prev, row.id])) : prev.filter((id) => id !== row.id),
                        )
                        if (checked) {
                          setQuestionScoreMap((prev) => ({
                            ...prev,
                            [row.id]: prev[row.id] ?? examDefaults.defaultQuestionScore,
                          }))
                        }
                      }}
                    />
                  )
                },
              },
              { title: '题型', dataIndex: 'type', width: 90 },
              { title: '题干', dataIndex: 'stem' },
              { title: '难度', dataIndex: 'difficulty', width: 90 },
              {
                title: '分值',
                key: 'score',
                width: 100,
                render: (_: unknown, row: { id: number }) => (
                  <Input
                    type="number"
                    min={1}
                    disabled={!selectedQuestionIds.includes(row.id)}
                    value={questionScoreMap[row.id] ?? examDefaults.defaultQuestionScore}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      setQuestionScoreMap((prev) => ({
                        ...prev,
                        [row.id]: Number.isNaN(value) || value <= 0 ? examDefaults.defaultQuestionScore : value,
                      }))
                    }}
                  />
                ),
              },
            ]}
            dataSource={questionOptions}
            pagination={{ pageSize: 6 }}
            size="small"
          />
        </Card>
      </Modal>
    </Space>
  )
}

function ExamDetailPage() {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const { examId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [resultStatusFilter, setResultStatusFilter] = useState<string | undefined>(undefined)
  const [resultKeyword, setResultKeyword] = useState('')
  const [detail, setDetail] = useState<{
    id: number
    title: string
    subject_name: string
    start_time: string
    end_time: string
    duration: number
    status: number
    description?: string
    expected_count: number
    submitted_count: number
    reviewed_count: number
    classes: Array<{ id: number; name: string; grade: string }>
    questions: Array<{
      question_id: number
      score: number
      sort_order: number
      question_type_text: string
      stem: string
      difficulty_text: string
    }>
    class_stats: Array<{
      class_id: number
      class_name: string
      class_grade: string
      expected_count: number
      submitted_count: number
      scored_count: number
      avg_score: number
      max_score: number
      min_score: number
    }>
    student_submissions: Array<{
      student_id: number
      student_name: string
      student_no: string
      submission_id?: number
      submission_status?: number
      submission_status_text: string
      submission_start_time?: string
      submit_time?: string
      total_score?: number
    }>
  } | null>(null)

  useEffect(() => {
    const load = async () => {
      if (!CAN_USE_API || !examId) return
      try {
        setLoading(true)
        const response = await fetch(`${API_BASE_URL}/api/exams/${examId}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          if (response.status === 403 || response.status === 404) {
            setDetail(null)
            return
          }
          throw new Error(payload?.message || `加载考试详情失败(${response.status})`)
        }
        setDetail(payload?.data ?? null)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '加载考试详情失败')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [authToken, examId])

  const statusText = detail?.status === 1 ? '未开始' : detail?.status === 2 ? '进行中' : '已结束'
  const filteredSubmissionRows = (detail?.student_submissions || []).filter((item) => {
    const statusOk = resultStatusFilter ? item.submission_status_text === resultStatusFilter : true
    const keyword = resultKeyword.trim()
    const keywordOk = keyword
      ? item.student_name.includes(keyword) || item.student_no.includes(keyword)
      : true
    return statusOk && keywordOk
  })
  const scoredRows = filteredSubmissionRows.filter((item) => typeof item.total_score === 'number')
  const scoreAvg = scoredRows.length ? Number((scoredRows.reduce((sum, item) => sum + Number(item.total_score), 0) / scoredRows.length).toFixed(2)) : 0
  const scoreMax = scoredRows.length ? Math.max(...scoredRows.map((item) => Number(item.total_score))) : 0
  const scoreMin = scoredRows.length ? Math.min(...scoredRows.map((item) => Number(item.total_score))) : 0

  const exportResults = () => {
    if (!detail) return
    const rows = filteredSubmissionRows.map((item, index) => ({
      序号: index + 1,
      姓名: item.student_name,
      学号: item.student_no,
      提交状态: item.submission_status_text,
      开始作答时间: item.submission_start_time ? item.submission_start_time.slice(0, 16).replace('T', ' ') : '',
      提交时间: item.submit_time ? item.submit_time.slice(0, 16).replace('T', ' ') : '',
      得分: typeof item.total_score === 'number' ? item.total_score : '',
    }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, '成绩明细')
    XLSX.writeFile(workbook, `exam_${detail.id}_results.xlsx`)
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        loading={loading}
        title="考试详情"
        extra={
          <Button onClick={() => navigate('/exams')} type="default">
            返回考试列表
          </Button>
        }
      >
        {!detail ? (
          <Empty description="暂无可查看的考试信息" />
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Card size="small" title={detail.title}>
              <Row gutter={12}>
                <Col span={6}>
                  <Statistic title="科目" value={detail.subject_name} />
                </Col>
                <Col span={6}>
                  <Statistic title="状态" value={statusText} />
                </Col>
                <Col span={6}>
                  <Statistic title="答题时长(分钟)" value={detail.duration} />
                </Col>
                <Col span={6}>
                  <Statistic title="提交人数/应考人数" value={`${detail.submitted_count}/${detail.expected_count}`} />
                </Col>
              </Row>
              <Typography.Paragraph style={{ marginTop: 12, marginBottom: 6 }}>
                时间：{detail.start_time.slice(0, 16).replace('T', ' ')} ~ {detail.end_time.slice(0, 16).replace('T', ' ')}
              </Typography.Paragraph>
              <Typography.Text type="secondary">考试说明：{detail.description || '无'}</Typography.Text>
            </Card>

            <Card size="small" title="关联班级">
              <Table
                pagination={false}
                dataSource={detail.classes.map((item) => ({ ...item, key: String(item.id) }))}
                columns={[
                  { title: '班级名称', dataIndex: 'name' },
                  { title: '年级', dataIndex: 'grade' },
                ]}
              />
            </Card>

            <Card size="small" title={`题目清单（共 ${detail.questions.length} 题）`}>
              <Table
                pagination={{ pageSize: 8 }}
                dataSource={detail.questions.map((item) => ({ ...item, key: `${item.question_id}-${item.sort_order}` }))}
                columns={[
                  { title: '序号', dataIndex: 'sort_order', width: 80 },
                  { title: '题型', dataIndex: 'question_type_text', width: 90 },
                  { title: '题干', dataIndex: 'stem' },
                  { title: '难度', dataIndex: 'difficulty_text', width: 90 },
                  { title: '分值', dataIndex: 'score', width: 90 },
                ]}
              />
            </Card>

            <Card size="small" title="提交进度">
              <Row gutter={12}>
                <Col span={8}>
                  <Statistic title="应考人数" value={detail.expected_count} />
                </Col>
                <Col span={8}>
                  <Statistic title="已提交人数" value={detail.submitted_count} />
                </Col>
                <Col span={8}>
                  <Statistic title="已出分人数" value={detail.reviewed_count} />
                </Col>
              </Row>
            </Card>

            <Card
              size="small"
              title="学生提交明细"
              extra={
                <Space>
                  <Input
                    value={resultKeyword}
                    onChange={(event) => setResultKeyword(event.target.value)}
                    placeholder="按姓名/学号筛选"
                    allowClear
                    style={{ width: 220 }}
                  />
                  <Select
                    value={resultStatusFilter}
                    onChange={(value) => setResultStatusFilter(value)}
                    allowClear
                    placeholder="提交状态"
                    style={{ width: 140 }}
                    options={[
                      { value: '未作答', label: '未作答' },
                      { value: '进行中', label: '进行中' },
                      { value: '已出分', label: '已出分' },
                    ]}
                  />
                  <Button onClick={exportResults}>导出成绩</Button>
                </Space>
              }
            >
              <Row gutter={12} style={{ marginBottom: 12 }}>
                <Col span={8}>
                  <Statistic title="已评分人数" value={scoredRows.length} />
                </Col>
                <Col span={8}>
                  <Statistic title="平均分" value={scoreAvg} />
                </Col>
                <Col span={4}>
                  <Statistic title="最高分" value={scoreMax} />
                </Col>
                <Col span={4}>
                  <Statistic title="最低分" value={scoreMin} />
                </Col>
              </Row>
              <Table
                pagination={{ pageSize: 10 }}
                dataSource={filteredSubmissionRows.map((item) => ({ ...item, key: String(item.student_id) }))}
                columns={[
                  { title: '姓名', dataIndex: 'student_name', width: 120 },
                  { title: '学号', dataIndex: 'student_no', width: 140 },
                  {
                    title: '提交状态',
                    dataIndex: 'submission_status_text',
                    width: 110,
                    render: (value: string) => {
                      if (value === '已出分') return <Tag color="green">{value}</Tag>
                      if (value === '进行中') return <Tag color="orange">{value}</Tag>
                      return <Tag>{value}</Tag>
                    },
                  },
                  {
                    title: '开始作答时间',
                    dataIndex: 'submission_start_time',
                    render: (value?: string) => (value ? value.slice(0, 16).replace('T', ' ') : '-'),
                  },
                  {
                    title: '提交时间',
                    dataIndex: 'submit_time',
                    render: (value?: string) => (value ? value.slice(0, 16).replace('T', ' ') : '-'),
                  },
                  {
                    title: '得分',
                    dataIndex: 'total_score',
                    width: 90,
                    render: (value?: number) => (typeof value === 'number' ? value : '-'),
                  },
                ]}
              />
            </Card>
          </Space>
        )}
      </Card>
    </Space>
  )
}

function AnalyticsPage() {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const authUserRaw = localStorage.getItem(AUTH_USER_KEY)
  const authUser: AuthUser | null = useMemo(() => {
    if (!authUserRaw) return null
    try {
      return JSON.parse(authUserRaw) as AuthUser
    } catch {
      return null
    }
  }, [authUserRaw])
  const canHandleWarning = Boolean(authUser?.roles?.includes('admin') || authUser?.roles?.includes('class_teacher'))
  const REVIEW_TASKS_STORAGE_KEY = 'quizwiz-analytics-review-tasks'
  const [loading, setLoading] = useState(false)
  const [classFilter, setClassFilter] = useState<number | undefined>(undefined)
  const [subjectFilter, setSubjectFilter] = useState<number | undefined>(undefined)
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [classOptions, setClassOptions] = useState<Array<{ label: string; value: number }>>([])
  const [subjectOptions, setSubjectOptions] = useState<Array<{ label: string; value: number }>>([])
  const [summaryRows, setSummaryRows] = useState<
    Array<{
      class_id: number
      class_name: string
      class_grade: string
      student_count: number
      exam_count: number
      scored_count: number
      avg_score: number
      max_score: number
      min_score: number
      pass_rate: number
      excellent_rate: number
    }>
  >([])
  const [trendRows, setTrendRows] = useState<
    Array<{ exam_id: number; exam_title: string; start_time: string; scored_count: number; avg_score: number }>
  >([])
  const [questionInsightRows, setQuestionInsightRows] = useState<
    Array<{
      question_id: number
      stem: string
      question_type: string | number
      difficulty: string | number
      attempt_count: number
      correct_count: number
      wrong_count: number
      correct_rate: number
      top_wrong_answers: Array<{ answer_text: string; wrong_times: number }>
      class_breakdown: Array<{
        class_id: number
        class_name: string
        attempt_count: number
        correct_count: number
        correct_rate: number
      }>
    }>
  >([])
  const [selectedQuestionId, setSelectedQuestionId] = useState<number | null>(null)
  const [warningThreshold, setWarningThreshold] = useState<number>(40)
  const [reviewTasks, setReviewTasks] = useState<
    Array<{
      task_key: string
      question_id: number
      stem: string
      correct_rate: number
      status: 'pending' | 'done'
      created_at: string
      done_at?: string
    }>
  >(() => {
    try {
      const raw = localStorage.getItem(REVIEW_TASKS_STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [studentWarningRows, setStudentWarningRows] = useState<
    Array<{
      class_id: number
      class_name: string
      class_grade: string
      student_id: number
      student_name: string
      student_no: string
      recent_exam_count: number
      missing_count: number
      recent_avg_score: number
      latest_score_1?: number | null
      latest_score_2?: number | null
      latest_score_3?: number | null
      warning_level: 'high' | 'medium'
      warning_reasons: string[]
      handle_status: 'pending' | 'in_progress' | 'resolved'
      handle_note?: string
      handled_at?: string | null
    }>
  >([])
  const [warningLevelFilter, setWarningLevelFilter] = useState<string | undefined>(undefined)
  const [warningHandleStatusFilter, setWarningHandleStatusFilter] = useState<string | undefined>(undefined)
  const [warningOverview, setWarningOverview] = useState<{
    class_distribution: Array<{ class_id: number; class_name: string; warning_count: number }>
    level_distribution: Array<{ level: string; key: string; count: number }>
    trend_7d: Array<{ day: string; warning_count: number }>
  }>({
    class_distribution: [],
    level_distribution: [],
    trend_7d: [],
  })
  const [examQualitySummary, setExamQualitySummary] = useState({
    exam_count: 0,
    expected_count: 0,
    submitted_count: 0,
    avg_score: 0,
    pass_rate: 0,
    excellent_rate: 0,
  })
  const [examQualityRows, setExamQualityRows] = useState<
    Array<{
      exam_id: number
      exam_title: string
      subject_name: string
      start_time: string
      end_time: string
      expected_count: number
      submitted_count: number
      scored_count: number
      avg_score: number
      score_stddev: number
      absence_rate: number
      pass_rate: number
      excellent_rate: number
    }>
  >([])
  const [selectedQualityExamId, setSelectedQualityExamId] = useState<number | undefined>(undefined)
  const [examItemQualitySummary, setExamItemQualitySummary] = useState({
    question_count: 0,
    reliability_index: 0,
    excellent_count: 0,
    risk_count: 0,
  })
  const [examItemQualityRows, setExamItemQualityRows] = useState<
    Array<{
      question_id: number
      stem: string
      question_type: string | number
      difficulty: string | number
      attempt_count: number
      correct_count: number
      correct_rate: number
      high_group_rate: number
      low_group_rate: number
      discrimination_index: number
      quality_level: string
    }>
  >([])
  const [examClassRankingRows, setExamClassRankingRows] = useState<
    Array<{
      rank_no: number
      class_id: number
      class_name: string
      class_grade: string
      expected_count: number
      submitted_count: number
      scored_count: number
      avg_score: number
      max_score: number
      min_score: number
      absence_rate: number
      pass_rate: number
      excellent_rate: number
    }>
  >([])
  const [warningHandleOpen, setWarningHandleOpen] = useState(false)
  const [warningHandleLoading, setWarningHandleLoading] = useState(false)
  const [selectedWarning, setSelectedWarning] = useState<{ classId: number; studentId: number; studentName: string } | null>(null)
  const [warningHandleForm] = Form.useForm()
  const [analyticsSection, setAnalyticsSection] = useState<'overview' | 'quality' | 'warning' | 'question'>('overview')

  const loadSubjectOptions = async () => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/subjects`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载科目失败(${response.status})`)
      setSubjectOptions(
        (Array.isArray(payload?.data) ? payload.data : []).map((item: Record<string, unknown>) => ({
          label: String(item.name || ''),
          value: Number(item.id),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载科目失败')
    }
  }

  const loadAnalytics = async (query?: { classId?: number; subjectId?: number; startTime?: string; endTime?: string }) => {
    if (!CAN_USE_API) return
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (query?.classId) params.set('classId', String(query.classId))
      if (query?.subjectId) params.set('subjectId', String(query.subjectId))
      if (query?.startTime) params.set('startTime', query.startTime)
      if (query?.endTime) params.set('endTime', query.endTime)
      const response = await fetch(`${API_BASE_URL}/api/analytics/class-performance?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载成绩分析失败(${response.status})`)
      const data = payload?.data || {}
      const options = (Array.isArray(data.class_options) ? data.class_options : []).map((item: Record<string, unknown>) => ({
        label: `${String(item.class_name || '')}（${String(item.class_grade || '-') }）`,
        value: Number(item.class_id),
      }))
      setClassOptions(options)
      setSummaryRows(Array.isArray(data.summary_rows) ? data.summary_rows : [])
      setTrendRows(Array.isArray(data.trend_rows) ? data.trend_rows : [])
      const selectedClassId = Number(data.selected_class_id || 0)
      if (!query?.classId && selectedClassId > 0) {
        setClassFilter(selectedClassId)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载班级成绩分析失败')
    } finally {
      setLoading(false)
    }
  }

  const loadQuestionInsights = async (query?: { classId?: number; subjectId?: number; startTime?: string; endTime?: string }) => {
    if (!CAN_USE_API) return
    try {
      const params = new URLSearchParams()
      if (query?.classId) params.set('classId', String(query.classId))
      if (query?.subjectId) params.set('subjectId', String(query.subjectId))
      if (query?.startTime) params.set('startTime', query.startTime)
      if (query?.endTime) params.set('endTime', query.endTime)
      params.set('limit', '30')
      const response = await fetch(`${API_BASE_URL}/api/analytics/question-insights?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载错题分析失败(${response.status})`)
      setQuestionInsightRows(Array.isArray(payload?.data) ? payload.data : [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载错题分析失败')
    }
  }

  const loadStudentWarnings = async (query?: {
    classId?: number
    subjectId?: number
    startTime?: string
    endTime?: string
    warningLevel?: string
    handleStatus?: string
  }) => {
    if (!CAN_USE_API) return
    try {
      const params = new URLSearchParams()
      if (query?.classId) params.set('classId', String(query.classId))
      if (query?.subjectId) params.set('subjectId', String(query.subjectId))
      if (query?.startTime) params.set('startTime', query.startTime)
      if (query?.endTime) params.set('endTime', query.endTime)
      if (query?.warningLevel) params.set('warningLevel', query.warningLevel)
      if (query?.handleStatus) params.set('handleStatus', query.handleStatus)
      const response = await fetch(`${API_BASE_URL}/api/analytics/student-warnings?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载学生预警失败(${response.status})`)
      setStudentWarningRows(Array.isArray(payload?.data?.rows) ? payload.data.rows : [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载学生预警失败')
    }
  }

  const loadWarningOverview = async (query?: {
    classId?: number
    subjectId?: number
    startTime?: string
    endTime?: string
    warningLevel?: string
    handleStatus?: string
  }) => {
    if (!CAN_USE_API) return
    try {
      const params = new URLSearchParams()
      if (query?.classId) params.set('classId', String(query.classId))
      if (query?.subjectId) params.set('subjectId', String(query.subjectId))
      if (query?.startTime) params.set('startTime', query.startTime)
      if (query?.endTime) params.set('endTime', query.endTime)
      if (query?.warningLevel) params.set('warningLevel', query.warningLevel)
      if (query?.handleStatus) params.set('handleStatus', query.handleStatus)
      const response = await fetch(`${API_BASE_URL}/api/analytics/student-warnings/overview?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载预警看板失败(${response.status})`)
      setWarningOverview({
        class_distribution: Array.isArray(payload?.data?.class_distribution) ? payload.data.class_distribution : [],
        level_distribution: Array.isArray(payload?.data?.level_distribution) ? payload.data.level_distribution : [],
        trend_7d: Array.isArray(payload?.data?.trend_7d) ? payload.data.trend_7d : [],
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载预警看板失败')
    }
  }

  const loadExamQualityOverview = async (query?: {
    classId?: number
    subjectId?: number
    startTime?: string
    endTime?: string
  }) => {
    if (!CAN_USE_API) return
    try {
      const params = new URLSearchParams()
      if (query?.classId) params.set('classId', String(query.classId))
      if (query?.subjectId) params.set('subjectId', String(query.subjectId))
      if (query?.startTime) params.set('startTime', query.startTime)
      if (query?.endTime) params.set('endTime', query.endTime)
      const response = await fetch(`${API_BASE_URL}/api/analytics/exam-quality-overview?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载考试质量分析失败(${response.status})`)
      setExamQualitySummary({
        exam_count: Number(payload?.data?.summary?.exam_count || 0),
        expected_count: Number(payload?.data?.summary?.expected_count || 0),
        submitted_count: Number(payload?.data?.summary?.submitted_count || 0),
        avg_score: Number(payload?.data?.summary?.avg_score || 0),
        pass_rate: Number(payload?.data?.summary?.pass_rate || 0),
        excellent_rate: Number(payload?.data?.summary?.excellent_rate || 0),
      })
      setExamQualityRows(Array.isArray(payload?.data?.rows) ? payload.data.rows : [])
      if (!query?.classId && !query?.subjectId && !query?.startTime && !query?.endTime) {
        const firstExamId = Number(payload?.data?.rows?.[0]?.exam_id || 0)
        if (firstExamId > 0) setSelectedQualityExamId(firstExamId)
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载考试质量分析失败')
    }
  }

  const loadExamItemQuality = async (examId?: number) => {
    if (!CAN_USE_API || !examId) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/exam-item-quality?examId=${examId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          setExamItemQualitySummary({
            question_count: 0,
            reliability_index: 0,
            excellent_count: 0,
            risk_count: 0,
          })
          setExamItemQualityRows([])
          return
        }
        throw new Error(payload?.message || `加载题目质量分析失败(${response.status})`)
      }
      setExamItemQualitySummary({
        question_count: Number(payload?.data?.summary?.question_count || 0),
        reliability_index: Number(payload?.data?.summary?.reliability_index || 0),
        excellent_count: Number(payload?.data?.summary?.excellent_count || 0),
        risk_count: Number(payload?.data?.summary?.risk_count || 0),
      })
      setExamItemQualityRows(Array.isArray(payload?.data?.rows) ? payload.data.rows : [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载题目区分度分析失败')
    }
  }

  const loadExamClassRanking = async (examId?: number) => {
    if (!CAN_USE_API || !examId) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/analytics/exam-class-ranking?examId=${examId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 403 || response.status === 404) {
          setExamClassRankingRows([])
          return
        }
        throw new Error(payload?.message || `加载班级排名失败(${response.status})`)
      }
      setExamClassRankingRows(Array.isArray(payload?.data?.rows) ? payload.data.rows : [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载班级对比排名失败')
    }
  }

  useEffect(() => {
    void loadSubjectOptions()
    void loadAnalytics()
    void loadQuestionInsights()
    void loadStudentWarnings()
    void loadWarningOverview()
    void loadExamQualityOverview()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadExamItemQuality(selectedQualityExamId)
    void loadExamClassRanking(selectedQualityExamId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedQualityExamId])

  useEffect(() => {
    localStorage.setItem(REVIEW_TASKS_STORAGE_KEY, JSON.stringify(reviewTasks))
  }, [reviewTasks, REVIEW_TASKS_STORAGE_KEY])

  const avgScoreOverview = summaryRows.length
    ? Number((summaryRows.reduce((sum, item) => sum + Number(item.avg_score || 0), 0) / summaryRows.length).toFixed(2))
    : 0
  const passRateOverview = summaryRows.length
    ? Number((summaryRows.reduce((sum, item) => sum + Number(item.pass_rate || 0), 0) / summaryRows.length).toFixed(2))
    : 0
  const excellentRateOverview = summaryRows.length
    ? Number((summaryRows.reduce((sum, item) => sum + Number(item.excellent_rate || 0), 0) / summaryRows.length).toFixed(2))
    : 0
  const totalScored = summaryRows.reduce((sum, item) => sum + Number(item.scored_count || 0), 0)
  const selectedQuestion = questionInsightRows.find((item) => Number(item.question_id) === Number(selectedQuestionId))
  const wrongAnswerChartData = Array.isArray(selectedQuestion?.top_wrong_answers)
    ? selectedQuestion.top_wrong_answers.map((item) => ({
        answer_text: String(item.answer_text || '-'),
        wrong_times: Number(item.wrong_times || 0),
      }))
    : []
  const classCompareChartData = Array.isArray(selectedQuestion?.class_breakdown)
    ? selectedQuestion.class_breakdown.map((item) => ({
        class_name: String(item.class_name || '-'),
        correct_rate: Number(item.correct_rate || 0),
        attempt_count: Number(item.attempt_count || 0),
      }))
    : []
  const warningRows = questionInsightRows.filter((item) => Number(item.correct_rate || 0) < Number(warningThreshold || 0))
  const pendingReviewCount = reviewTasks.filter((item) => item.status === 'pending').length

  const exportQuestionInsights = () => {
    try {
      const summarySheetRows = questionInsightRows.map((item) => ({
        题目ID: item.question_id,
        题型: mapQuestionTypeFromApi(item.question_type),
        难度: mapDifficultyFromApi(item.difficulty),
        题干: String(item.stem || ''),
        作答数: Number(item.attempt_count || 0),
        答对数: Number(item.correct_count || 0),
        答错数: Number(item.wrong_count || 0),
        正确率: `${Number(item.correct_rate || 0)}%`,
        高频错误答案: Array.isArray(item.top_wrong_answers)
          ? item.top_wrong_answers.map((v) => `${String(v.answer_text || '-')}(${Number(v.wrong_times || 0)}次)`).join('；')
          : '',
      }))
      const classSheetRows = questionInsightRows.flatMap((item) =>
        (Array.isArray(item.class_breakdown) ? item.class_breakdown : []).map((row) => ({
          题目ID: item.question_id,
          题干: String(item.stem || ''),
          班级: String(row.class_name || '-'),
          作答人数: Number(row.attempt_count || 0),
          答对人数: Number(row.correct_count || 0),
          正确率: `${Number(row.correct_rate || 0)}%`,
        })),
      )
      const workbook = XLSX.utils.book_new()
      const summarySheet = XLSX.utils.json_to_sheet(summarySheetRows)
      XLSX.utils.book_append_sheet(workbook, summarySheet, '错题总览')
      const classSheet = XLSX.utils.json_to_sheet(classSheetRows)
      XLSX.utils.book_append_sheet(workbook, classSheet, '班级对比')
      XLSX.writeFile(workbook, `question_insights_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出错题分析失败')
    }
  }

  const createReviewTasks = () => {
    const now = new Date().toISOString()
    const existingKeys = new Set(reviewTasks.map((item) => item.task_key))
    const nextTasks = [...reviewTasks]
    warningRows.forEach((row) => {
      const key = `q-${Number(row.question_id)}`
      if (!existingKeys.has(key)) {
        nextTasks.push({
          task_key: key,
          question_id: Number(row.question_id),
          stem: String(row.stem || ''),
          correct_rate: Number(row.correct_rate || 0),
          status: 'pending',
          created_at: now,
        })
      }
    })
    setReviewTasks(nextTasks)
    message.success(`已生成讲评任务 ${Math.max(nextTasks.length - reviewTasks.length, 0)} 条`)
  }

  const toggleReviewTask = (taskKey: string, done: boolean) => {
    setReviewTasks((prev) =>
      prev.map((item) =>
        item.task_key === taskKey
          ? {
              ...item,
              status: done ? 'done' : 'pending',
              done_at: done ? new Date().toISOString() : undefined,
            }
          : item,
      ),
    )
  }

  const clearCompletedTasks = () => {
    setReviewTasks((prev) => prev.filter((item) => item.status !== 'done'))
    message.success('已清空已讲评任务')
  }

  const exportStudentWarnings = () => {
    try {
      const rows = studentWarningRows.map((item) => ({
        班级: `${item.class_name}（${item.class_grade || '-'}）`,
        学生姓名: item.student_name,
        学号: item.student_no,
        预警等级: item.warning_level === 'high' ? '高' : '中',
        处理状态: item.handle_status === 'resolved' ? '已完成' : item.handle_status === 'in_progress' ? '跟进中' : '待跟进',
        触发原因: Array.isArray(item.warning_reasons) ? item.warning_reasons.join('；') : '',
        处理备注: String(item.handle_note || ''),
        处理时间: item.handled_at ? item.handled_at.slice(0, 19).replace('T', ' ') : '',
        近期待均分: item.recent_avg_score,
        最近成绩1: item.latest_score_1 ?? '',
        最近成绩2: item.latest_score_2 ?? '',
        最近成绩3: item.latest_score_3 ?? '',
        未提交次数: item.missing_count,
      }))
      const sheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, '学生预警')
      XLSX.writeFile(workbook, `student_warnings_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出学生预警失败')
    }
  }

  const exportExamQualityOverview = () => {
    try {
      const rows = examQualityRows.map((item) => ({
        考试ID: item.exam_id,
        考试名称: item.exam_title,
        科目: item.subject_name,
        开始时间: item.start_time ? item.start_time.slice(0, 19).replace('T', ' ') : '',
        结束时间: item.end_time ? item.end_time.slice(0, 19).replace('T', ' ') : '',
        应考人数: item.expected_count,
        实考人数: item.submitted_count,
        出分人数: item.scored_count,
        缺考率: `${item.absence_rate}%`,
        平均分: item.avg_score,
        标准差: item.score_stddev,
        及格率: `${item.pass_rate}%`,
        优秀率: `${item.excellent_rate}%`,
      }))
      const sheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, '考试质量总览')
      XLSX.writeFile(workbook, `exam_quality_overview_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出考试质量总览失败')
    }
  }

  const exportExamItemQuality = () => {
    try {
      const rows = examItemQualityRows.map((item) => ({
        题目ID: item.question_id,
        题型: mapQuestionTypeFromApi(item.question_type),
        难度: mapDifficultyFromApi(item.difficulty),
        题干: item.stem,
        作答人数: item.attempt_count,
        答对人数: item.correct_count,
        正确率: `${item.correct_rate}%`,
        高分组正确率: `${item.high_group_rate}%`,
        低分组正确率: `${item.low_group_rate}%`,
        区分度指数: item.discrimination_index,
        质量评级: item.quality_level === 'excellent' ? '优质题' : item.quality_level === 'risk' ? '问题题' : '普通题',
      }))
      const sheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, '题目区分度')
      XLSX.writeFile(workbook, `exam_item_quality_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出题目区分度失败')
    }
  }

  const exportExamClassRanking = () => {
    try {
      const rows = examClassRankingRows.map((item) => ({
        排名: item.rank_no,
        班级: `${item.class_name}（${item.class_grade || '-'}）`,
        应考人数: item.expected_count,
        实考人数: item.submitted_count,
        出分人数: item.scored_count,
        平均分: item.avg_score,
        最高分: item.max_score,
        最低分: item.min_score,
        缺考率: `${item.absence_rate}%`,
        及格率: `${item.pass_rate}%`,
        优秀率: `${item.excellent_rate}%`,
      }))
      const sheet = XLSX.utils.json_to_sheet(rows)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, sheet, '班级对比排名')
      XLSX.writeFile(workbook, `exam_class_ranking_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出班级排名失败')
    }
  }

  const exportQualityReportBundle = () => {
    try {
      const workbook = XLSX.utils.book_new()
      const overviewRows = examQualityRows.map((item) => ({
        考试ID: item.exam_id,
        考试名称: item.exam_title,
        科目: item.subject_name,
        开始时间: item.start_time ? item.start_time.slice(0, 19).replace('T', ' ') : '',
        结束时间: item.end_time ? item.end_time.slice(0, 19).replace('T', ' ') : '',
        应考人数: item.expected_count,
        实考人数: item.submitted_count,
        出分人数: item.scored_count,
        缺考率: `${item.absence_rate}%`,
        平均分: item.avg_score,
        标准差: item.score_stddev,
        及格率: `${item.pass_rate}%`,
        优秀率: `${item.excellent_rate}%`,
      }))
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overviewRows), '考试质量总览')

      const itemRows = examItemQualityRows.map((item) => ({
        题目ID: item.question_id,
        题型: mapQuestionTypeFromApi(item.question_type),
        难度: mapDifficultyFromApi(item.difficulty),
        题干: item.stem,
        作答人数: item.attempt_count,
        答对人数: item.correct_count,
        正确率: `${item.correct_rate}%`,
        高分组正确率: `${item.high_group_rate}%`,
        低分组正确率: `${item.low_group_rate}%`,
        区分度指数: item.discrimination_index,
        质量评级: item.quality_level === 'excellent' ? '优质题' : item.quality_level === 'risk' ? '问题题' : '普通题',
      }))
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(itemRows), '题目区分度与信度')

      const rankingRows = examClassRankingRows.map((item) => ({
        排名: item.rank_no,
        班级: `${item.class_name}（${item.class_grade || '-'}）`,
        应考人数: item.expected_count,
        实考人数: item.submitted_count,
        出分人数: item.scored_count,
        平均分: item.avg_score,
        最高分: item.max_score,
        最低分: item.min_score,
        缺考率: `${item.absence_rate}%`,
        及格率: `${item.pass_rate}%`,
        优秀率: `${item.excellent_rate}%`,
      }))
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rankingRows), '班级对比排名')
      XLSX.writeFile(workbook, `exam_quality_report_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出质量报告失败')
    }
  }

  const submitWarningHandle = async () => {
    if (!CAN_USE_API || !selectedWarning) return
    try {
      const values = await warningHandleForm.validateFields()
      setWarningHandleLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/analytics/student-warnings/handle`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          classId: selectedWarning.classId,
          studentId: selectedWarning.studentId,
          status: values.status,
          note: String(values.note || ''),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `保存处理结果失败(${response.status})`)
      message.success('预警处理状态已更新')
      setWarningHandleOpen(false)
      warningHandleForm.resetFields()
      setSelectedWarning(null)
      await loadStudentWarnings({
        classId: classFilter,
        subjectId: subjectFilter,
        startTime,
        endTime,
        warningLevel: warningLevelFilter,
        handleStatus: warningHandleStatusFilter,
      })
      await loadWarningOverview({
        classId: classFilter,
        subjectId: subjectFilter,
        startTime,
        endTime,
        warningLevel: warningLevelFilter,
        handleStatus: warningHandleStatusFilter,
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '处理预警失败')
    } finally {
      setWarningHandleLoading(false)
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={16}>
      <Card title="班级维度成绩分析看板">
        <Space wrap>
          <Select
            allowClear
            placeholder="班级"
            style={{ width: 220 }}
            value={classFilter}
            onChange={(value) => setClassFilter(value)}
            options={classOptions}
          />
          <Select
            allowClear
            placeholder="科目"
            style={{ width: 180 }}
            value={subjectFilter}
            onChange={(value) => setSubjectFilter(value)}
            options={subjectOptions}
          />
          <Input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: 220 }} />
          <Input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: 220 }} />
          <Button
            type="primary"
            onClick={() => {
              const query = {
                classId: classFilter,
                subjectId: subjectFilter,
                startTime,
                endTime,
                warningLevel: warningLevelFilter,
                handleStatus: warningHandleStatusFilter,
              }
              void Promise.all([
                loadAnalytics(query),
                loadQuestionInsights(query),
                loadStudentWarnings(query),
                loadWarningOverview(query),
                loadExamQualityOverview(query),
              ])
            }}
          >
            查询
          </Button>
          <Button
            onClick={() => {
              setClassFilter(undefined)
              setSubjectFilter(undefined)
              setStartTime('')
              setEndTime('')
              setWarningLevelFilter(undefined)
              setWarningHandleStatusFilter(undefined)
              void Promise.all([loadAnalytics({}), loadQuestionInsights({}), loadStudentWarnings({}), loadWarningOverview({}), loadExamQualityOverview({})])
            }}
          >
            重置
          </Button>
          <Button onClick={exportQualityReportBundle}>导出质量报告</Button>
        </Space>
      </Card>
      <Segmented
        block
        value={analyticsSection}
        onChange={(value) => setAnalyticsSection(value as 'overview' | 'quality' | 'warning' | 'question')}
        options={[
          { label: '总览', value: 'overview' },
          { label: '考试质量', value: 'quality' },
          { label: '预警中心', value: 'warning' },
          { label: '错题讲评', value: 'question' },
        ]}
      />
      {analyticsSection === 'overview' ? (
        <>
      <Row gutter={16}>
        <Col span={6}><Card><Statistic title="班级数" value={summaryRows.length} /></Card></Col>
        <Col span={6}><Card><Statistic title="已出分总人次" value={totalScored} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均分（班级均值）" value={avgScoreOverview} precision={2} /></Card></Col>
        <Col span={6}><Card><Statistic title="平均及格率" value={passRateOverview} precision={2} suffix="%" /></Card></Col>
      </Row>
      <Card title="班级统计明细">
        <Table
          rowKey="class_id"
          loading={loading}
          dataSource={summaryRows}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '班级', dataIndex: 'class_name', width: 140 },
            { title: '年级', dataIndex: 'class_grade', width: 100 },
            { title: '学生数', dataIndex: 'student_count', width: 90 },
            { title: '考试场次', dataIndex: 'exam_count', width: 90 },
            { title: '已出分人次', dataIndex: 'scored_count', width: 110 },
            { title: '平均分', dataIndex: 'avg_score', width: 90 },
            { title: '最高分', dataIndex: 'max_score', width: 90 },
            { title: '最低分', dataIndex: 'min_score', width: 90 },
            { title: '及格率', dataIndex: 'pass_rate', render: (value: number) => `${Number(value || 0)}%`, width: 90 },
            { title: '优秀率', dataIndex: 'excellent_rate', render: (value: number) => `${Number(value || 0)}%`, width: 90 },
          ]}
        />
      </Card>
      <Row gutter={16}>
        <Col span={16}>
          <Card title="班级成绩趋势（按考试）">
            {trendRows.length === 0 ? (
              <Empty description="暂无趋势数据" />
            ) : (
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <LineChart
                    data={trendRows.map((item) => ({
                      ...item,
                      x_label: `${item.exam_title}-${item.start_time ? item.start_time.slice(5, 10).replace('-', '/') : ''}`,
                    }))}
                  >
                    <XAxis dataKey="x_label" />
                    <YAxis />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="avg_score" stroke="#1677ff" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="趋势摘要">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Statistic title="趋势考试数" value={trendRows.length} />
              <Statistic title="趋势平均分" value={trendRows.length ? Number((trendRows.reduce((sum, item) => sum + item.avg_score, 0) / trendRows.length).toFixed(2)) : 0} precision={2} />
              <Statistic title="平均优秀率（班级）" value={excellentRateOverview} suffix="%" precision={2} />
            </Space>
          </Card>
        </Col>
      </Row>
        </>
      ) : null}
      {analyticsSection === 'question' ? (
      <Row gutter={16}>
        <Col span={6}>
          <Card>
            <Statistic title={`低正确率预警（<${warningThreshold}%）`} value={warningRows.length} valueStyle={{ color: warningRows.length > 0 ? '#cf1322' : undefined }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待讲评任务数" value={pendingReviewCount} valueStyle={{ color: pendingReviewCount > 0 ? '#d46b08' : undefined }} />
          </Card>
        </Col>
        <Col span={10}>
          <Card>
            <Space>
              <Typography.Text>预警阈值（正确率%）</Typography.Text>
              <Input
                type="number"
                min={1}
                max={100}
                value={String(warningThreshold)}
                onChange={(e) => setWarningThreshold(Math.min(Math.max(Number(e.target.value) || 1, 1), 100))}
                style={{ width: 120 }}
              />
              <Typography.Text type="secondary">低于该阈值的题目将被高亮</Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>
      ) : null}
      {analyticsSection === 'quality' ? (
      <>
      <Card
        title="考试质量总览"
        extra={
          <Space>
            <Button onClick={exportExamQualityOverview}>导出考试质量</Button>
          </Space>
        }
      >
        <Row gutter={16}>
          <Col span={4}><Statistic title="考试场次" value={examQualitySummary.exam_count} /></Col>
          <Col span={4}><Statistic title="应考总人数" value={examQualitySummary.expected_count} /></Col>
          <Col span={4}><Statistic title="实考总人数" value={examQualitySummary.submitted_count} /></Col>
          <Col span={4}><Statistic title="平均分" value={examQualitySummary.avg_score} precision={2} /></Col>
          <Col span={4}><Statistic title="平均及格率" value={examQualitySummary.pass_rate} precision={2} suffix="%" /></Col>
          <Col span={4}><Statistic title="平均优秀率" value={examQualitySummary.excellent_rate} precision={2} suffix="%" /></Col>
        </Row>
        <Table
          style={{ marginTop: 12 }}
          rowKey="exam_id"
          dataSource={examQualityRows}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '考试', dataIndex: 'exam_title', width: 180 },
            { title: '科目', dataIndex: 'subject_name', width: 100 },
            { title: '开始时间', dataIndex: 'start_time', render: (v: string) => (v ? v.slice(0, 16).replace('T', ' ') : '-'), width: 150 },
            { title: '应考', dataIndex: 'expected_count', width: 70 },
            { title: '实考', dataIndex: 'submitted_count', width: 70 },
            { title: '缺考率', dataIndex: 'absence_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
            { title: '平均分', dataIndex: 'avg_score', width: 80 },
            { title: '标准差', dataIndex: 'score_stddev', width: 80 },
            { title: '及格率', dataIndex: 'pass_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
            { title: '优秀率', dataIndex: 'excellent_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
          ]}
        />
      </Card>
      <Card
        title="题目区分度与信度"
        extra={
          <Space>
            <Select
              placeholder="选择考试"
              style={{ width: 280 }}
              value={selectedQualityExamId}
              onChange={(value) => setSelectedQualityExamId(value)}
              options={examQualityRows.map((item) => ({
                value: Number(item.exam_id),
                label: `${item.exam_title}（${item.subject_name}）`,
              }))}
            />
            <Button onClick={exportExamItemQuality}>导出题目质量</Button>
          </Space>
        }
      >
        <Row gutter={16}>
          <Col span={6}><Statistic title="题目数量" value={examItemQualitySummary.question_count} /></Col>
          <Col span={6}><Statistic title="信度指数(KR-20)" value={examItemQualitySummary.reliability_index} precision={4} /></Col>
          <Col span={6}><Statistic title="优质题数量" value={examItemQualitySummary.excellent_count} /></Col>
          <Col span={6}><Statistic title="问题题数量" value={examItemQualitySummary.risk_count} valueStyle={{ color: examItemQualitySummary.risk_count > 0 ? '#cf1322' : undefined }} /></Col>
        </Row>
        <Table
          style={{ marginTop: 12 }}
          rowKey="question_id"
          dataSource={examItemQualityRows}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '题目ID', dataIndex: 'question_id', width: 90 },
            { title: '题型', dataIndex: 'question_type', render: (v: string | number) => mapQuestionTypeFromApi(v), width: 90 },
            { title: '难度', dataIndex: 'difficulty', render: (v: string | number) => mapDifficultyFromApi(v), width: 90 },
            { title: '题干', dataIndex: 'stem', ellipsis: true },
            { title: '作答', dataIndex: 'attempt_count', width: 70 },
            { title: '正确率', dataIndex: 'correct_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
            { title: '高分组', dataIndex: 'high_group_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
            { title: '低分组', dataIndex: 'low_group_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
            { title: '区分度', dataIndex: 'discrimination_index', width: 90 },
            {
              title: '质量评级',
              dataIndex: 'quality_level',
              width: 90,
              render: (v: string) => (v === 'excellent' ? <Tag color="success">优质题</Tag> : v === 'risk' ? <Tag color="error">问题题</Tag> : <Tag>普通题</Tag>),
            },
          ]}
        />
      </Card>
      <Card
        title="同场考试班级对比与排名"
        extra={
          <Space>
            <Button onClick={exportExamClassRanking}>导出班级排名</Button>
          </Space>
        }
      >
        <Table
          rowKey="class_id"
          dataSource={examClassRankingRows}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '排名', dataIndex: 'rank_no', width: 70 },
            { title: '班级', render: (_: unknown, row: { class_name: string; class_grade: string }) => `${row.class_name}（${row.class_grade || '-'}）`, width: 160 },
            { title: '应考', dataIndex: 'expected_count', width: 70 },
            { title: '实考', dataIndex: 'submitted_count', width: 70 },
            { title: '出分', dataIndex: 'scored_count', width: 70 },
            { title: '平均分', dataIndex: 'avg_score', width: 80 },
            { title: '最高分', dataIndex: 'max_score', width: 80 },
            { title: '最低分', dataIndex: 'min_score', width: 80 },
            { title: '缺考率', dataIndex: 'absence_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
            { title: '及格率', dataIndex: 'pass_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
            { title: '优秀率', dataIndex: 'excellent_rate', render: (v: number) => `${Number(v || 0)}%`, width: 90 },
          ]}
        />
      </Card>
      </>
      ) : null}
      {analyticsSection === 'warning' ? (
      <>
      <Card
        title="学生学业预警名单"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="预警等级"
              style={{ width: 130 }}
              value={warningLevelFilter}
              onChange={(value) => setWarningLevelFilter(value)}
              options={[
                { value: 'high', label: '高预警' },
                { value: 'medium', label: '中预警' },
              ]}
            />
            <Select
              allowClear
              placeholder="处理状态"
              style={{ width: 150 }}
              value={warningHandleStatusFilter}
              onChange={(value) => setWarningHandleStatusFilter(value)}
              options={[
                { value: 'pending', label: '待跟进' },
                { value: 'in_progress', label: '跟进中' },
                { value: 'resolved', label: '已完成' },
              ]}
            />
            <Button onClick={exportStudentWarnings}>导出预警名单</Button>
          </Space>
        }
      >
        <Table
          rowKey="key"
          dataSource={studentWarningRows.map((item) => ({ ...item, key: `${item.class_id}-${item.student_id}` }))}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '班级', render: (_: unknown, row: Record<string, unknown>) => `${String(row.class_name || '')}（${String(row.class_grade || '-')}）`, width: 180 },
            { title: '学生姓名', dataIndex: 'student_name', width: 110 },
            { title: '学号', dataIndex: 'student_no', width: 130 },
            {
              title: '预警等级',
              dataIndex: 'warning_level',
              width: 90,
              render: (value: string) => (value === 'high' ? <Tag color="error">高</Tag> : <Tag color="warning">中</Tag>),
            },
            {
              title: '触发原因',
              dataIndex: 'warning_reasons',
              render: (value: string[]) => (Array.isArray(value) ? value.join('；') : '-'),
            },
            {
              title: '处理状态',
              dataIndex: 'handle_status',
              width: 100,
              render: (value: string) =>
                value === 'resolved' ? (
                  <Tag color="success">已完成</Tag>
                ) : value === 'in_progress' ? (
                  <Tag color="processing">跟进中</Tag>
                ) : (
                  <Tag color="default">待跟进</Tag>
                ),
            },
            {
              title: '处理时间',
              dataIndex: 'handled_at',
              width: 160,
              render: (value?: string) => (value ? value.slice(0, 19).replace('T', ' ') : '-'),
            },
            {
              title: '处理备注',
              dataIndex: 'handle_note',
              render: (value?: string) => value || '-',
            },
            { title: '近期待均分', dataIndex: 'recent_avg_score', width: 100 },
            {
              title: '最近3次成绩',
              width: 160,
              render: (_: unknown, row: Record<string, unknown>) =>
                [row.latest_score_1, row.latest_score_2, row.latest_score_3]
                  .map((v) => (typeof v === 'number' ? String(v) : '-'))
                  .join(' / '),
            },
            { title: '未提交次数', dataIndex: 'missing_count', width: 100 },
            ...(canHandleWarning
              ? [
                  {
                    title: '操作',
                    key: 'action',
                    width: 90,
                    render: (_: unknown, row: Record<string, unknown>) => (
                      <Button
                        type="link"
                        onClick={() => {
                          setSelectedWarning({
                            classId: Number(row.class_id || 0),
                            studentId: Number(row.student_id || 0),
                            studentName: String(row.student_name || ''),
                          })
                          warningHandleForm.setFieldsValue({
                            status: String(row.handle_status || 'pending'),
                            note: String(row.handle_note || ''),
                          })
                          setWarningHandleOpen(true)
                        }}
                      >
                        处理
                      </Button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
      <Modal
        title="处理学生预警"
        open={warningHandleOpen}
        onCancel={() => {
          setWarningHandleOpen(false)
          setSelectedWarning(null)
          warningHandleForm.resetFields()
        }}
        onOk={() => void submitWarningHandle()}
        confirmLoading={warningHandleLoading}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text>{selectedWarning ? `学生：${selectedWarning.studentName}` : ''}</Typography.Text>
          <Form form={warningHandleForm} layout="vertical">
            <Form.Item name="status" label="处理状态" rules={[{ required: true, message: '请选择处理状态' }]}>
              <Select
                options={[
                  { value: 'pending', label: '待跟进' },
                  { value: 'in_progress', label: '跟进中' },
                  { value: 'resolved', label: '已完成' },
                ]}
              />
            </Form.Item>
            <Form.Item name="note" label="处理备注">
              <Input.TextArea rows={4} placeholder="可填写跟进措施、家校沟通、辅导安排等" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
      <Row gutter={16}>
        <Col span={10}>
          <Card title="班级预警人数分布">
            {warningOverview.class_distribution.length > 0 ? (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={warningOverview.class_distribution}>
                    <XAxis dataKey="class_name" />
                    <YAxis allowDecimals={false} />
                    <RechartsTooltip />
                    <Legend />
                    <Bar dataKey="warning_count" name="预警人数" fill="#faad14" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty description="暂无预警分布数据" />
            )}
          </Card>
        </Col>
        <Col span={6}>
          <Card title="预警等级分布">
            {warningOverview.level_distribution.length > 0 ? (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={warningOverview.level_distribution}>
                    <XAxis dataKey="level" />
                    <YAxis allowDecimals={false} />
                    <RechartsTooltip />
                    <Legend />
                    <Bar dataKey="count" name="人数" fill="#ff7875" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty description="暂无等级分布数据" />
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="近7天新增预警趋势">
            {warningOverview.trend_7d.length > 0 ? (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <LineChart data={warningOverview.trend_7d.map((item) => ({ ...item, day_label: item.day.slice(5).replace('-', '/') }))}>
                    <XAxis dataKey="day_label" />
                    <YAxis allowDecimals={false} />
                    <RechartsTooltip />
                    <Legend />
                    <Line type="monotone" dataKey="warning_count" name="新增预警人数" stroke="#ff4d4f" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty description="暂无趋势数据" />
            )}
          </Card>
        </Col>
      </Row>
      <Card title="班级统计明细">
        <Table
          rowKey="class_id"
          loading={loading}
          dataSource={summaryRows}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: '班级', dataIndex: 'class_name', width: 140 },
            { title: '年级', dataIndex: 'class_grade', width: 100 },
            { title: '学生数', dataIndex: 'student_count', width: 90 },
            { title: '考试场次', dataIndex: 'exam_count', width: 90 },
            { title: '已出分人次', dataIndex: 'scored_count', width: 110 },
            { title: '平均分', dataIndex: 'avg_score', width: 90 },
            { title: '最高分', dataIndex: 'max_score', width: 90 },
            { title: '最低分', dataIndex: 'min_score', width: 90 },
            { title: '及格率', dataIndex: 'pass_rate', render: (value: number) => `${Number(value || 0)}%`, width: 90 },
            { title: '优秀率', dataIndex: 'excellent_rate', render: (value: number) => `${Number(value || 0)}%`, width: 90 },
          ]}
        />
      </Card>
      <Row gutter={16}>
        <Col span={16}>
          <Card title="班级成绩趋势（按考试）">
            {trendRows.length === 0 ? (
              <Empty description="暂无趋势数据" />
            ) : (
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <LineChart
                    data={trendRows.map((item) => ({
                      ...item,
                      x_label: `${item.exam_title}-${item.start_time ? item.start_time.slice(5, 10).replace('-', '/') : ''}`,
                    }))}
                  >
                    <XAxis dataKey="x_label" />
                    <YAxis />
                    <RechartsTooltip />
                    <Line type="monotone" dataKey="avg_score" stroke="#1677ff" strokeWidth={3} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card title="趋势摘要">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Statistic title="趋势考试数" value={trendRows.length} />
              <Statistic title="趋势平均分" value={trendRows.length ? Number((trendRows.reduce((sum, item) => sum + item.avg_score, 0) / trendRows.length).toFixed(2)) : 0} precision={2} />
              <Statistic title="平均优秀率（班级）" value={excellentRateOverview} suffix="%" precision={2} />
            </Space>
          </Card>
        </Col>
      </Row>
      </>
      ) : null}
      {analyticsSection === 'question' ? (
      <>
      <Card
        title="错题分析（按题目）"
        extra={
          <Space>
            <Button type="primary" onClick={createReviewTasks}>
              生成讲评任务单
            </Button>
            <Button onClick={exportQuestionInsights}>导出错题分析</Button>
          </Space>
        }
      >
        <Table
          rowKey="question_id"
          loading={loading}
          dataSource={questionInsightRows}
          pagination={{ pageSize: 8 }}
          rowClassName={(row) => (Number((row as { correct_rate?: number }).correct_rate || 0) < warningThreshold ? 'analytics-warning-row' : '')}
          expandable={{
            expandedRowRender: (row: {
              class_breakdown?: Array<{
                class_id: number
                class_name: string
                attempt_count: number
                correct_count: number
                correct_rate: number
              }>
            }) => (
              <Table
                size="small"
                rowKey="class_id"
                pagination={false}
                dataSource={Array.isArray(row.class_breakdown) ? row.class_breakdown : []}
                columns={[
                  { title: '班级', dataIndex: 'class_name', width: 140 },
                  { title: '作答人数', dataIndex: 'attempt_count', width: 90 },
                  { title: '答对人数', dataIndex: 'correct_count', width: 90 },
                  { title: '正确率', dataIndex: 'correct_rate', render: (value: number) => `${Number(value || 0)}%`, width: 90 },
                ]}
              />
            ),
          }}
          columns={[
            { title: '题目ID', dataIndex: 'question_id', width: 90 },
            {
              title: '题干',
              dataIndex: 'stem',
              ellipsis: true,
              render: (value: string) => value || '-',
            },
            {
              title: '题型',
              dataIndex: 'question_type',
              width: 90,
              render: (value: string | number) => mapQuestionTypeFromApi(value),
            },
            {
              title: '难度',
              dataIndex: 'difficulty',
              width: 90,
              render: (value: string | number) => mapDifficultyFromApi(value),
            },
            { title: '作答数', dataIndex: 'attempt_count', width: 80 },
            { title: '答对数', dataIndex: 'correct_count', width: 80 },
            { title: '答错数', dataIndex: 'wrong_count', width: 80 },
            {
              title: '正确率',
              dataIndex: 'correct_rate',
              width: 90,
              render: (value: number) => {
                const rate = Number(value || 0)
                return rate < warningThreshold ? <Tag color="error">{rate}%</Tag> : `${rate}%`
              },
            },
            {
              title: '高频错误答案',
              dataIndex: 'top_wrong_answers',
              width: 260,
              render: (value: Array<{ answer_text: string; wrong_times: number }>) =>
                Array.isArray(value) && value.length > 0
                  ? value.map((item) => `${String(item.answer_text || '-')}（${Number(item.wrong_times || 0)}次）`).join('，')
                  : '-',
            },
            {
              title: '图表',
              width: 90,
              render: (_: unknown, row: Record<string, unknown>) => (
                <Button type="link" onClick={() => setSelectedQuestionId(Number(row.question_id || 0))}>
                  查看
                </Button>
              ),
            },
          ]}
        />
      </Card>
      <Card
        title="错题讲评任务单"
        extra={
          <Space>
            <Button onClick={clearCompletedTasks}>清空已讲评</Button>
          </Space>
        }
      >
        <Table
          rowKey="task_key"
          dataSource={reviewTasks}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: '题目ID', dataIndex: 'question_id', width: 90 },
            { title: '题干', dataIndex: 'stem', ellipsis: true },
            { title: '正确率', dataIndex: 'correct_rate', width: 90, render: (value: number) => `${Number(value || 0)}%` },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (value: string) => (value === 'done' ? <Tag color="success">已讲评</Tag> : <Tag color="warning">待讲评</Tag>),
            },
            {
              title: '创建时间',
              dataIndex: 'created_at',
              width: 170,
              render: (value: string) => (value ? value.slice(0, 19).replace('T', ' ') : '-'),
            },
            {
              title: '完成时间',
              dataIndex: 'done_at',
              width: 170,
              render: (value?: string) => (value ? value.slice(0, 19).replace('T', ' ') : '-'),
            },
            {
              title: '操作',
              key: 'action',
              width: 120,
              render: (_: unknown, row: Record<string, unknown>) =>
                String(row.status || 'pending') === 'done' ? (
                  <Button type="link" onClick={() => toggleReviewTask(String(row.task_key || ''), false)}>
                    撤销
                  </Button>
                ) : (
                  <Button type="link" onClick={() => toggleReviewTask(String(row.task_key || ''), true)}>
                    标记已讲评
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <Row gutter={16}>
        <Col span={12}>
          <Card title="错误选项分布（当前选题）">
            {selectedQuestionId && wrongAnswerChartData.length > 0 ? (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={wrongAnswerChartData}>
                    <XAxis dataKey="answer_text" />
                    <YAxis allowDecimals={false} />
                    <RechartsTooltip />
                    <Legend />
                    <Bar dataKey="wrong_times" name="错误次数" fill="#ff7875" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty description="请在上方表格中点击“查看”选择题目" />
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="班级正确率对比（当前选题）">
            {selectedQuestionId && classCompareChartData.length > 0 ? (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={classCompareChartData}>
                    <XAxis dataKey="class_name" />
                    <YAxis />
                    <RechartsTooltip />
                    <Legend />
                    <Bar dataKey="correct_rate" name="正确率(%)" fill="#5b8ff9" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Empty description="请在上方表格中点击“查看”选择题目" />
            )}
          </Card>
        </Col>
      </Row>
      </>
      ) : null}
    </Space>
  )
}

function ResourcePage({ authUser }: { authUser: AuthUser }) {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const canManageResource = useMemo(
    () => authUser.roles.includes('admin') || authUser.roles.includes('class_teacher'),
    [authUser.roles],
  )
  const canAuditResource = useMemo(
    () => authUser.roles.includes('admin') || authUser.roles.includes('class_teacher'),
    [authUser.roles],
  )
  const [resourceTab, setResourceTab] = useState<'list' | 'audit'>('list')
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditRows, setAuditRows] = useState<
    Array<{
      id: number
      operator_name: string
      operator_phone: string
      resource_id: string
      resource_name: string
      file_name: string
      created_at: string
    }>
  >([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditPageSize, setAuditPageSize] = useState(20)
  const [auditKeyword, setAuditKeyword] = useState('')
  const [auditStartTime, setAuditStartTime] = useState('')
  const [auditEndTime, setAuditEndTime] = useState('')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [openCreate, setOpenCreate] = useState(false)
  const [openVisibility, setOpenVisibility] = useState(false)
  const [saving, setSaving] = useState(false)
  const [folderFilter, setFolderFilter] = useState<string | undefined>(undefined)
  const [keyword, setKeyword] = useState('')
  const [resourceListPage, setResourceListPage] = useState(1)
  const [resourceListPageSize, setResourceListPageSize] = useState(20)
  const [resourceListTotal, setResourceListTotal] = useState(0)
  const [rows, setRows] = useState<
    Array<{
      key: string
      id: number
      name: string
      file_url: string
      file_type: string
      folder: string
      uploader_name: string
      created_at: string
      visible_classes: Array<{ class_id: number; class_name: string; class_grade: string }>
    }>
  >([])
  const [folderOptions, setFolderOptions] = useState<Array<{ value: string; label: string }>>([])
  const [classOptions, setClassOptions] = useState<Array<{ value: number; label: string }>>([])
  const [uploadFileList, setUploadFileList] = useState<UploadFile[]>([])
  const [visibilityResource, setVisibilityResource] = useState<{ id: number; name: string } | null>(null)
  const [createForm] = Form.useForm()
  const [visibilityForm] = Form.useForm()

  const folderLabelMap = useMemo(() => {
    const map: Record<string, string> = {}
    folderOptions.forEach((item) => {
      map[item.value] = item.label
    })
    return map
  }, [folderOptions])

  const loadMeta = async () => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/resources/meta`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 403) {
          setFolderOptions([])
          setClassOptions([])
          return
        }
        throw new Error(payload?.message || `加载资料库元数据失败(${response.status})`)
      }
      setFolderOptions(
        (Array.isArray(payload?.data?.folders) ? payload.data.folders : []).map((item: Record<string, unknown>) => ({
          value: String(item.key || ''),
          label: String(item.label || ''),
        })),
      )
      setClassOptions(
        (Array.isArray(payload?.data?.classes) ? payload.data.classes : []).map((item: Record<string, unknown>) => ({
          value: Number(item.id || 0),
          label: `${String(item.name || '')}（${String(item.grade || '-')}）`,
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载资料库元数据失败')
    }
  }

  const loadResources = async (overrides?: { folder?: string; keyword?: string; page?: number; pageSize?: number }) => {
    if (!CAN_USE_API) return
    try {
      setLoading(true)
      const params = new URLSearchParams()
      const effectiveFolder = overrides?.folder ?? folderFilter
      const effectiveKeyword = overrides?.keyword ?? keyword
      const page = overrides?.page ?? resourceListPage
      const pageSize = overrides?.pageSize ?? resourceListPageSize
      if (effectiveFolder) params.set('folder', effectiveFolder)
      if (effectiveKeyword.trim()) params.set('keyword', effectiveKeyword.trim())
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const response = await fetch(`${API_BASE_URL}/api/resources?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 403) {
          setRows([])
          setResourceListTotal(0)
          setResourceListPage(page)
          setResourceListPageSize(pageSize)
          return
        }
        throw new Error(payload?.message || `加载资料失败(${response.status})`)
      }
      setResourceListPage(page)
      setResourceListPageSize(pageSize)
      setResourceListTotal(Number(payload?.pagination?.total ?? 0))
      setRows(
        (Array.isArray(payload?.data) ? payload.data : []).map((item: Record<string, unknown>, index: number) => ({
          key: String(item.id ?? `resource-${index}`),
          id: Number(item.id || 0),
          name: String(item.name || ''),
          file_url: String(item.file_url || ''),
          file_type: String(item.file_type || ''),
          folder: String(item.folder || 'other'),
          uploader_name: String(item.uploader_name || ''),
          created_at: String(item.created_at || ''),
          visible_classes: Array.isArray(item.visible_classes) ? (item.visible_classes as Array<{ class_id: number; class_name: string; class_grade: string }>) : [],
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载资料失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMeta()
    void loadResources({ page: 1, pageSize: 20 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadDownloadAuditLogs = async (opts?: {
    page?: number
    pageSize?: number
    keyword?: string
    startTime?: string
    endTime?: string
  }) => {
    if (!CAN_USE_API || !canAuditResource) return
    const page = opts?.page ?? auditPage
    const pageSize = opts?.pageSize ?? auditPageSize
    const kw = opts?.keyword !== undefined ? opts.keyword : auditKeyword
    const st = opts?.startTime !== undefined ? opts.startTime : auditStartTime
    const et = opts?.endTime !== undefined ? opts.endTime : auditEndTime
    try {
      setAuditLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (kw.trim()) params.set('keyword', kw.trim())
      if (st) params.set('startTime', st)
      if (et) params.set('endTime', et)
      const response = await fetch(`${API_BASE_URL}/api/resources/download-logs?${params.toString()}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载下载审计失败(${response.status})`)
      const list = Array.isArray(payload?.data) ? payload.data : []
      setAuditRows(
        list.map((item: Record<string, unknown>, index: number) => ({
          id: Number(item.id ?? index),
          operator_name: String(item.operator_name || ''),
          operator_phone: String(item.operator_phone || ''),
          resource_id: String(item.resource_id || ''),
          resource_name: String(item.resource_name || ''),
          file_name: String(item.file_name || ''),
          created_at: String(item.created_at || ''),
        })),
      )
      setAuditTotal(Number(payload?.pagination?.total ?? 0))
      setAuditPage(Number(payload?.pagination?.page ?? page))
      setAuditPageSize(Number(payload?.pagination?.pageSize ?? pageSize))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载下载审计失败')
    } finally {
      setAuditLoading(false)
    }
  }

  const exportDownloadAudit = async () => {
    if (!CAN_USE_API || !canAuditResource) return
    try {
      const merged: Array<{
        id: number
        operator_name: string
        operator_phone: string
        resource_id: string
        resource_name: string
        file_name: string
        created_at: string
      }> = []
      let page = 1
      const pageSize = 200
      while (merged.length < 2000) {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(pageSize))
        if (auditKeyword.trim()) params.set('keyword', auditKeyword.trim())
        if (auditStartTime) params.set('startTime', auditStartTime)
        if (auditEndTime) params.set('endTime', auditEndTime)
        const response = await fetch(`${API_BASE_URL}/api/resources/download-logs?${params.toString()}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.message || `导出失败(${response.status})`)
        const list = Array.isArray(payload?.data) ? payload.data : []
        if (list.length === 0) break
        list.forEach((item: Record<string, unknown>, index: number) => {
          merged.push({
            id: Number(item.id ?? merged.length + index),
            operator_name: String(item.operator_name || ''),
            operator_phone: String(item.operator_phone || ''),
            resource_id: String(item.resource_id || ''),
            resource_name: String(item.resource_name || ''),
            file_name: String(item.file_name || ''),
            created_at: String(item.created_at || ''),
          })
        })
        if (list.length < pageSize) break
        page += 1
      }
      if (merged.length === 0) {
        message.info('没有可导出的记录')
        return
      }
      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.json_to_sheet(
        merged.map((row) => ({
          下载时间: row.created_at ? row.created_at.slice(0, 19).replace('T', ' ') : '',
          操作人: row.operator_name,
          手机号: row.operator_phone,
          资料ID: row.resource_id,
          资料名称: row.resource_name,
          存储文件名: row.file_name,
        })),
      )
      XLSX.utils.book_append_sheet(workbook, sheet, '资料下载审计')
      XLSX.writeFile(workbook, `resource_download_audit_${new Date().toISOString().slice(0, 10)}.xlsx`)
      message.success(`已导出 ${merged.length} 条（单次最多 2000 条）`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导出失败')
    }
  }

  const submitCreateResource = async () => {
    if (!CAN_USE_API) return
    try {
      const values = await createForm.validateFields()
      setSaving(true)
      const response = await fetch(`${API_BASE_URL}/api/resources`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          name: String(values.name || '').trim(),
          fileUrl: String(values.fileUrl || '').trim(),
          fileType: String(values.fileType || '').trim() || 'file',
          folder: String(values.folder || 'other').trim(),
          classIds: Array.isArray(values.classIds) ? values.classIds : [],
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `新增资料失败(${response.status})`)
      message.success('资料新增成功')
      setOpenCreate(false)
      createForm.resetFields()
      setUploadFileList([])
      await loadResources()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新增资料失败')
    } finally {
      setSaving(false)
    }
  }

  const deleteResource = async (id: number) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/resources/${id}`, {
        method: 'DELETE',
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `删除资料失败(${response.status})`)
      message.success('资料已删除')
      await loadResources()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除资料失败')
    }
  }

  const downloadResource = async (row: { id: number; name: string }) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/resources/${row.id}/download`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.message || `下载资料失败(${response.status})`)
      }
      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = row.name || `resource-${row.id}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(blobUrl)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '下载资料失败')
    }
  }

  const moveResourceFolder = async (id: number, folder: string) => {
    if (!CAN_USE_API) return
    try {
      const response = await fetch(`${API_BASE_URL}/api/resources/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ folder }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `移动资料失败(${response.status})`)
      message.success('资料已移动')
      await loadResources()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '移动资料失败')
    }
  }

  const openVisibilityModal = (row: {
    id: number
    name: string
    visible_classes: Array<{ class_id: number }>
  }) => {
    setVisibilityResource({ id: row.id, name: row.name })
    visibilityForm.setFieldsValue({
      classIds: Array.isArray(row.visible_classes) ? row.visible_classes.map((item) => item.class_id) : [],
    })
    setOpenVisibility(true)
  }

  const submitVisibility = async () => {
    if (!CAN_USE_API || !visibilityResource) return
    try {
      const values = await visibilityForm.validateFields()
      setSaving(true)
      const response = await fetch(`${API_BASE_URL}/api/resources/${visibilityResource.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          classIds: Array.isArray(values.classIds) ? values.classIds : [],
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `更新可见班级失败(${response.status})`)
      message.success('可见班级已更新')
      setOpenVisibility(false)
      setVisibilityResource(null)
      await loadResources()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新可见班级失败')
    } finally {
      setSaving(false)
    }
  }

  const previewResource = (row: { file_url: string; file_type: string; name: string }) => {
    const rawUrl = String(row.file_url || '').trim()
    if (!rawUrl) {
      message.warning('文件地址为空，无法预览')
      return
    }
    const absoluteUrl = /^https?:\/\//i.test(rawUrl)
      ? rawUrl
      : `${String(API_BASE_URL || '').replace(/\/$/, '')}/${rawUrl.replace(/^\//, '')}`
    const ext = (rawUrl.split('?')[0].split('.').pop() || '').toLowerCase()
    const isOfficeDoc = row.file_type === 'doc' || ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)
    if (isOfficeDoc) {
      const officePreviewUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(absoluteUrl)}`
      window.open(officePreviewUrl, '_blank', 'noopener,noreferrer')
      return
    }
    window.open(absoluteUrl, '_blank', 'noopener,noreferrer')
  }

  const uploadProps: UploadProps = {
    name: 'file',
    maxCount: 1,
    fileList: uploadFileList,
    customRequest: async (options) => {
      if (!CAN_USE_API) return
      const file = options.file as File
      const formData = new FormData()
      formData.append('file', file)
      try {
        setUploading(true)
        const response = await fetch(`${API_BASE_URL}/api/resources/upload`, {
          method: 'POST',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
          body: formData,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.message || `上传失败(${response.status})`)
        const fileUrl = String(payload?.data?.fileUrl || '')
        const fileType = String(payload?.data?.fileType || 'file')
        if (!fileUrl) throw new Error('上传成功但未返回文件地址')
        createForm.setFieldsValue({
          fileUrl,
          fileType,
          name: createForm.getFieldValue('name') || String(payload?.data?.fileName || file.name || ''),
        })
        setUploadFileList([
          {
            uid: String(Date.now()),
            name: file.name,
            status: 'done',
            url: fileUrl,
          },
        ])
        options.onSuccess?.(payload, file)
        message.success('文件上传成功')
      } catch (error) {
        options.onError?.(error as Error)
        message.error(error instanceof Error ? error.message : '上传失败')
      } finally {
        setUploading(false)
      }
    },
    onRemove: () => {
      createForm.setFieldValue('fileUrl', '')
      setUploadFileList([])
      return true
    },
  }

  const listTabContent = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Space wrap>
        <Select
          allowClear
          placeholder="分类文件夹"
          style={{ width: 180 }}
          value={folderFilter}
          onChange={(value) => setFolderFilter(value)}
          options={folderOptions}
        />
        <Input.Search
          placeholder="资料名称搜索"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onSearch={(value) => {
            setKeyword(value)
            setResourceListPage(1)
            void loadResources({ keyword: value, page: 1 })
          }}
          style={{ width: 240 }}
        />
        <Button type="primary" onClick={() => void loadResources({ page: 1 })}>
          查询
        </Button>
        <Button
          onClick={() => {
            setFolderFilter(undefined)
            setKeyword('')
            setResourceListPage(1)
            void loadResources({ folder: '', keyword: '', page: 1 })
          }}
        >
          重置
        </Button>
        <Button onClick={() => void loadResources()}>刷新</Button>
        {canManageResource ? (
          <Button
            type="primary"
            onClick={() => {
              createForm.resetFields()
              createForm.setFieldsValue({ folder: 'other', fileType: 'file', classIds: [] })
              setUploadFileList([])
              setOpenCreate(true)
            }}
          >
            上传资料
          </Button>
        ) : null}
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        dataSource={rows}
        pagination={{
          current: resourceListPage,
          pageSize: resourceListPageSize,
          total: resourceListTotal,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (p, ps) => {
            setResourceListPage(p)
            setResourceListPageSize(ps)
            void loadResources({ page: p, pageSize: ps })
          },
        }}
        scroll={{ x: canManageResource ? 1200 : 1060 }}
        columns={[
          { title: '资料名称', dataIndex: 'name', width: 140, ellipsis: true },
          { title: '分类', dataIndex: 'folder', width: 110, render: (value: string) => folderLabelMap[value] || value || '-' },
          { title: '类型', dataIndex: 'file_type', width: 100 },
          {
            title: '可见班级',
            dataIndex: 'visible_classes',
            width: canManageResource ? 220 : 320,
            ellipsis: true,
            render: (items: Array<{ class_name: string; class_grade: string }>) =>
              Array.isArray(items) && items.length > 0 ? items.map((item) => `${item.class_name}（${item.class_grade || '-'}）`).join('、') : '全部可见',
          },
          { title: '上传人', dataIndex: 'uploader_name', width: 110, render: (v: string) => v || '-' },
          { title: '上传时间', dataIndex: 'created_at', width: 170, render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '-') },
          {
            title: '操作',
            key: 'action',
            width: canManageResource ? 260 : 140,
            render: (_: unknown, row: {
              id: number
              file_url: string
              file_type: string
              visible_classes: Array<{ class_id: number }>
              name: string
              folder: string
            }) => (
              <Space size={4} wrap>
                <Button size="small" type="link" onClick={() => previewResource(row)}>
                  预览
                </Button>
                <Button size="small" type="link" onClick={() => void downloadResource(row)}>
                  下载
                </Button>
                {canManageResource ? (
                  <>
                    <Button size="small" type="link" onClick={() => openVisibilityModal(row)}>
                      设置可见班级
                    </Button>
                    <Select
                      size="small"
                      placeholder="移动"
                      style={{ width: 92 }}
                      options={folderOptions
                        .filter((item) => item.value !== row.folder)
                        .map((item) => ({ value: item.value, label: item.label }))}
                      onChange={(value) => {
                        if (value) void moveResourceFolder(row.id, value)
                      }}
                    />
                    <Popconfirm title="确认删除该资料？" okText="删除" cancelText="取消" onConfirm={() => void deleteResource(row.id)}>
                      <Button size="small" type="link" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </>
                ) : null}
              </Space>
            ),
          },
        ]}
        locale={{ emptyText: '暂无资料' }}
      />
    </Space>
  )

  const auditTabContent = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        记录通过系统「下载」按钮触发的资料下载；班主任仅能看到与自己负责班级或本人上传相关的资料下载记录。
      </Typography.Paragraph>
      <Space wrap>
        <Input
          placeholder="关键词：姓名/手机/资料名/文件名/资料ID"
          allowClear
          value={auditKeyword}
          onChange={(e) => setAuditKeyword(e.target.value)}
          style={{ width: 280 }}
          onPressEnter={() => void loadDownloadAuditLogs({ page: 1 })}
        />
        <Input type="datetime-local" value={auditStartTime} onChange={(e) => setAuditStartTime(e.target.value)} style={{ width: 200 }} />
        <Input type="datetime-local" value={auditEndTime} onChange={(e) => setAuditEndTime(e.target.value)} style={{ width: 200 }} />
        <Button type="primary" onClick={() => void loadDownloadAuditLogs({ page: 1 })}>
          查询
        </Button>
        <Button
          onClick={() => {
            setAuditKeyword('')
            setAuditStartTime('')
            setAuditEndTime('')
            void loadDownloadAuditLogs({ page: 1, pageSize: auditPageSize, keyword: '', startTime: '', endTime: '' })
          }}
        >
          重置
        </Button>
        <Button onClick={() => void loadDownloadAuditLogs()}>刷新</Button>
        <Button onClick={() => void exportDownloadAudit()}>导出 Excel</Button>
      </Space>
      <Table
        rowKey="id"
        loading={auditLoading}
        dataSource={auditRows}
        scroll={{ x: 920 }}
        pagination={{
          current: auditPage,
          pageSize: auditPageSize,
          total: auditTotal,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, pageSize) => void loadDownloadAuditLogs({ page, pageSize }),
        }}
        columns={[
          {
            title: '下载时间',
            dataIndex: 'created_at',
            width: 170,
            render: (v: string) => (v ? v.slice(0, 19).replace('T', ' ') : '-'),
          },
          { title: '操作人', dataIndex: 'operator_name', width: 100, ellipsis: true },
          { title: '手机号', dataIndex: 'operator_phone', width: 118 },
          { title: '资料ID', dataIndex: 'resource_id', width: 88 },
          { title: '资料名称', dataIndex: 'resource_name', width: 140, ellipsis: true },
          { title: '存储文件名', dataIndex: 'file_name', width: 150, ellipsis: true },
        ]}
        locale={{ emptyText: '暂无下载记录' }}
      />
    </Space>
  )

  return (
    <Card title="资料库">
      <Tabs
        activeKey={canAuditResource ? resourceTab : 'list'}
        onChange={(key) => {
          const next = key as 'list' | 'audit'
          setResourceTab(next)
          if (next === 'audit') void loadDownloadAuditLogs({ page: 1 })
        }}
        items={
          canAuditResource
            ? [
                { key: 'list', label: '资料列表', children: listTabContent },
                { key: 'audit', label: '下载审计', children: auditTabContent },
              ]
            : [{ key: 'list', label: '资料列表', children: listTabContent }]
        }
      />
      {canManageResource ? (
        <Modal
          title="上传资料"
          open={openCreate}
          onCancel={() => setOpenCreate(false)}
          onOk={() => void submitCreateResource()}
          confirmLoading={saving || uploading}
        >
          <Form form={createForm} layout="vertical">
            <Form.Item name="name" label="资料名称" rules={[{ required: true, message: '请输入资料名称' }]}>
              <Input placeholder="例如：函数专题课件.pdf" />
            </Form.Item>
            <Form.Item label="上传文件">
              <Upload {...uploadProps}>
                <Button loading={uploading}>选择文件并上传</Button>
              </Upload>
              <Typography.Text type="secondary">支持 PDF/Office/图片/MP4，最大100MB</Typography.Text>
            </Form.Item>
            <Form.Item name="fileUrl" label="文件地址" rules={[{ required: true, message: '请先上传文件或填写地址' }]}>
              <Input placeholder="上传后自动回填，也可手工填写外链" />
            </Form.Item>
            <Form.Item name="fileType" label="文件类型">
              <Select
                options={[
                  { value: 'pdf', label: 'PDF' },
                  { value: 'doc', label: '文档' },
                  { value: 'video', label: '视频' },
                  { value: 'image', label: '图片' },
                  { value: 'file', label: '其他' },
                ]}
              />
            </Form.Item>
            <Form.Item name="folder" label="分类文件夹" rules={[{ required: true, message: '请选择分类' }]}>
              <Select options={folderOptions} />
            </Form.Item>
            <Form.Item name="classIds" label="可见班级（为空表示全部可见）">
              <Select mode="multiple" allowClear options={classOptions} />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}
      {canManageResource ? (
        <Modal
          title={`设置可见班级${visibilityResource ? `（${visibilityResource.name}）` : ''}`}
          open={openVisibility}
          onCancel={() => {
            setOpenVisibility(false)
            setVisibilityResource(null)
          }}
          onOk={() => void submitVisibility()}
          confirmLoading={saving}
        >
          <Form form={visibilityForm} layout="vertical">
            <Form.Item name="classIds" label="可见班级（为空表示全部可见）">
              <Select mode="multiple" allowClear options={classOptions} />
            </Form.Item>
          </Form>
        </Modal>
      ) : null}
    </Card>
  )
}

function TeacherAccountsPage({ authUser }: { authUser: AuthUser }) {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const isAdmin = authUser.roles.includes('admin')
  const [loading, setLoading] = useState(false)
  const [openCreate, setOpenCreate] = useState(false)
  const [rows, setRows] = useState<TeacherAccountRow[]>([])
  const [subjectOptions, setSubjectOptions] = useState<Array<{ label: string; value: number }>>([])
  const [form] = Form.useForm()

  const loadData = async () => {
    if (!CAN_USE_API) return
    try {
      setLoading(true)
      const [userRes, subjectRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/users`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        }),
        fetch(`${API_BASE_URL}/api/subjects`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        }),
      ])
      if (!userRes.ok) throw new Error(`加载账号失败(${userRes.status})`)
      if (!subjectRes.ok) throw new Error(`加载科目失败(${subjectRes.status})`)
      const userPayload = await userRes.json()
      const subjectPayload = await subjectRes.json()
      const nextRows: TeacherAccountRow[] = (Array.isArray(userPayload?.data) ? userPayload.data : []).map((item: Record<string, unknown>) => ({
        key: String(item.id),
        id: Number(item.id),
        name: String(item.name ?? ''),
        phone: String(item.phone ?? ''),
        roles: Array.isArray(item.roles) ? (item.roles as string[]) : [],
        subjects: Array.isArray(item.subjects) ? (item.subjects as string[]) : [],
        status: Number(item.status ?? 1),
        created_at: String(item.created_at ?? ''),
      }))
      setRows(nextRows)
      setSubjectOptions(
        (Array.isArray(subjectPayload?.data) ? subjectPayload.data : []).map((item: Record<string, unknown>) => ({
          label: String(item.name ?? ''),
          value: Number(item.id),
        })),
      )
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载教师账号失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const roleOptions = isAdmin
    ? [
        { label: '管理员', value: 'admin' },
        { label: '班主任', value: 'class_teacher' },
        { label: '科任教师', value: 'subject_teacher' },
      ]
    : [{ label: '科任教师', value: 'subject_teacher' }]

  const handleCreate = async (values: {
    name: string
    phone: string
    password: string
    roles: string[]
    subjectIds?: number[]
  }) => {
    if (!CAN_USE_API) return
    try {
      const payload = {
        ...values,
        roles: isAdmin ? values.roles : ['subject_teacher'],
        subjectIds: values.roles?.includes('subject_teacher') || !isAdmin ? values.subjectIds || [] : [],
      }
      const response = await fetch(`${API_BASE_URL}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.message || `新增失败(${response.status})`)
      message.success('账号创建成功')
      setOpenCreate(false)
      form.resetFields()
      await loadData()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '账号创建失败')
    }
  }

  return (
    <Card
      title="教师账号管理"
      extra={
        <Space>
          <Button onClick={() => void loadData()}>刷新</Button>
          <Button
            type="primary"
            onClick={() => {
              form.setFieldsValue({ roles: isAdmin ? [] : ['subject_teacher'], subjectIds: [] })
              setOpenCreate(true)
            }}
          >
            新增账号
          </Button>
        </Space>
      }
    >
      <Table
        loading={loading}
        dataSource={rows}
        columns={[
          { title: '姓名', dataIndex: 'name' },
          { title: '手机号', dataIndex: 'phone' },
          {
            title: '角色',
            dataIndex: 'roles',
            render: (roles: string[]) =>
              roles.map((role) => {
                if (role === 'admin') return <Tag key={role}>管理员</Tag>
                if (role === 'class_teacher') return <Tag key={role}>班主任</Tag>
                return <Tag key={role}>科任教师</Tag>
              }),
          },
          {
            title: '科目',
            dataIndex: 'subjects',
            render: (subjects: string[]) => (subjects.length > 0 ? subjects.join(' / ') : '-'),
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (status: number) => (status === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">禁用</Tag>),
          },
          ...(isAdmin
            ? [
                {
                  title: '启用/禁用',
                  key: 'statusSwitch',
                  render: (_: unknown, record: TeacherAccountRow) => (
                    <Switch
                      checked={record.status === 1}
                      checkedChildren="启用"
                      unCheckedChildren="禁用"
                      onChange={async (checked) => {
                        if (!CAN_USE_API) return
                        try {
                          const response = await fetch(`${API_BASE_URL}/api/users/${record.id}/status`, {
                            method: 'PATCH',
                            headers: {
                              'Content-Type': 'application/json',
                              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                            },
                            body: JSON.stringify({ status: checked ? 1 : 0 }),
                          })
                          const payload = await response.json().catch(() => ({}))
                          if (!response.ok) {
                            throw new Error(payload?.message || `状态更新失败(${response.status})`)
                          }
                          message.success(`已${checked ? '启用' : '禁用'} ${record.name}`)
                          await loadData()
                        } catch (error) {
                          message.error(error instanceof Error ? error.message : '更新状态失败')
                        }
                      }}
                    />
                  ),
                },
              ]
            : []),
          ...(isAdmin
            ? [
                {
                  title: '操作',
                  key: 'actions',
                  render: (_: unknown, record: TeacherAccountRow) => (
                    <Button
                      type="link"
                      danger
                      onClick={() => {
                        Modal.confirm({
                          title: '确认重置密码',
                          content: `将 ${record.name} 的密码重置为 123456，是否继续？`,
                          okText: '确认重置',
                          cancelText: '取消',
                          onOk: async () => {
                            if (!CAN_USE_API) return
                            try {
                              const response = await fetch(`${API_BASE_URL}/api/users/${record.id}/reset-password`, {
                                method: 'POST',
                                headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
                              })
                              const payload = await response.json().catch(() => ({}))
                              if (!response.ok) {
                                throw new Error(payload?.message || `重置失败(${response.status})`)
                              }
                              message.success(`已重置 ${record.name} 的密码为 123456`)
                            } catch (error) {
                              message.error(error instanceof Error ? error.message : '重置密码失败')
                            }
                          },
                        })
                      }}
                    >
                      重置密码
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal open={openCreate} title="新增教师账号" onCancel={() => setOpenCreate(false)} onOk={() => form.submit()} okText="创建账号">
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="手机号" rules={[{ required: true, message: '请输入手机号' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, message: '请输入初始密码' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="roles" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select mode={isAdmin ? 'multiple' : undefined} options={roleOptions} disabled={!isAdmin} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {({ getFieldValue }) => {
              const roles: string[] = getFieldValue('roles') || []
              const showSubjects = !isAdmin || roles.includes('subject_teacher')
              if (!showSubjects) return null
              return (
                <Form.Item name="subjectIds" label="授课科目" rules={[{ required: true, message: '请选择至少一个科目' }]}>
                  <Select mode="multiple" options={subjectOptions} />
                </Form.Item>
              )
            }}
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}

function SystemSettingsPage() {
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const [subjects, setSubjects] = useState<Array<{ id: number; name: string; sort_order: number }>>([])
  const [subjectLoading, setSubjectLoading] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [logRows, setLogRows] = useState<
    Array<{
      id: number
      operator_name: string
      action: string
      target_type?: string
      target_id?: string
      detail?: Record<string, unknown>
      created_at: string
    }>
  >([])
  const [logActionFilter, setLogActionFilter] = useState<string | undefined>(undefined)
  const [logKeyword, setLogKeyword] = useState('')
  const [logStartTime, setLogStartTime] = useState('')
  const [logEndTime, setLogEndTime] = useState('')
  const [logPage, setLogPage] = useState(1)
  const [logPageSize, setLogPageSize] = useState(12)
  const [logTotal, setLogTotal] = useState(0)
  const [configLoading, setConfigLoading] = useState(false)
  const [examDefaultConfig, setExamDefaultConfig] = useState({
    defaultDurationMinutes: 60,
    defaultQuestionScore: 1,
    copyStartOffsetMinutes: 10,
  })
  const [warningRuleConfig, setWarningRuleConfig] = useState({
    recentExamCount: 5,
    avgScoreThreshold: 60,
    missingThreshold: 2,
  })

  const loadSubjects = async () => {
    if (!CAN_USE_API) return
    try {
      setSubjectLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/subjects`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载科目失败(${response.status})`)
      setSubjects(Array.isArray(payload?.data) ? payload.data : [])
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载科目失败')
    } finally {
      setSubjectLoading(false)
    }
  }

  useEffect(() => {
    void loadSubjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLogs = async (params?: {
    action?: string
    keyword?: string
    startTime?: string
    endTime?: string
    page?: number
    pageSize?: number
  }) => {
    if (!CAN_USE_API) return
    try {
      setLogLoading(true)
      const query = new URLSearchParams()
      const nextAction = params?.action ?? logActionFilter
      const nextKeyword = params?.keyword ?? logKeyword.trim()
      const nextStartTime = params?.startTime ?? logStartTime
      const nextEndTime = params?.endTime ?? logEndTime
      const nextPage = params?.page ?? logPage
      const nextPageSize = params?.pageSize ?? logPageSize
      if (nextAction) query.set('action', nextAction)
      if (nextKeyword) query.set('keyword', nextKeyword)
      if (nextStartTime) query.set('startTime', nextStartTime)
      if (nextEndTime) query.set('endTime', nextEndTime)
      query.set('page', String(nextPage))
      query.set('pageSize', String(nextPageSize))
      const response = await fetch(`${API_BASE_URL}/api/operation-logs${query.toString() ? `?${query.toString()}` : ''}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载日志失败(${response.status})`)
      setLogRows(Array.isArray(payload?.data) ? payload.data : [])
      setLogTotal(Number(payload?.pagination?.total || 0))
      setLogPage(Number(payload?.pagination?.page || nextPage))
      setLogPageSize(Number(payload?.pagination?.pageSize || nextPageSize))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载操作日志失败')
    } finally {
      setLogLoading(false)
    }
  }

  useEffect(() => {
    void loadLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadExamDefaultConfig = async () => {
    if (!CAN_USE_API) return
    try {
      setConfigLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/system-configs/exam-default`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载参数失败(${response.status})`)
      setExamDefaultConfig({
        defaultDurationMinutes: Number(payload?.data?.defaultDurationMinutes || 60),
        defaultQuestionScore: Number(payload?.data?.defaultQuestionScore || 1),
        copyStartOffsetMinutes: Number(payload?.data?.copyStartOffsetMinutes || 10),
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载考试默认参数失败')
    } finally {
      setConfigLoading(false)
    }
  }

  const loadWarningRuleConfig = async () => {
    if (!CAN_USE_API) return
    try {
      setConfigLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/system-configs/warning-rule`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载参数失败(${response.status})`)
      setWarningRuleConfig({
        recentExamCount: Math.min(Math.max(Number(payload?.data?.recentExamCount || 5), 3), 12),
        avgScoreThreshold: Math.max(Number(payload?.data?.avgScoreThreshold || 60), 0),
        missingThreshold: Math.max(Number(payload?.data?.missingThreshold || 2), 1),
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载预警规则参数失败')
    } finally {
      setConfigLoading(false)
    }
  }

  useEffect(() => {
    void loadExamDefaultConfig()
    void loadWarningRuleConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createSubject = async () => {
    if (!CAN_USE_API) return
    const name = newSubject.trim()
    if (!name) {
      message.warning('请输入科目名称')
      return
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/subjects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ name }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `新增失败(${response.status})`)
      message.success('科目新增成功')
      setNewSubject('')
      await loadSubjects()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新增科目失败')
    }
  }

  const deleteSubject = (id: number, name: string) => {
    Modal.confirm({
      title: '确认删除科目',
      content: `删除后不可恢复：${name}`,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (!CAN_USE_API) return
        try {
          const response = await fetch(`${API_BASE_URL}/api/subjects/${id}`, {
            method: 'DELETE',
            headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
          })
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(payload?.message || `删除失败(${response.status})`)
          message.success('科目删除成功')
          await loadSubjects()
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除科目失败')
        }
      },
    })
  }

  const actionLabelMap: Record<string, string> = {
    'exam.create': '创建考试',
    'exam.update': '编辑考试',
    'exam.publish': '发布考试',
    'exam.finish': '提前结束考试',
    'exam.reopen': '再开启考试',
    'exam.copy': '复制考试',
    'exam.delete': '删除考试',
    'subject.create': '新增科目',
    'subject.delete': '删除科目',
    'user.reset_password': '重置密码',
    'user.self_profile_update': '修改个人资料',
    'user.self_password_change': '修改登录密码',
    'user.update_status': '修改账号状态',
    'system_config.exam_default.update': '更新考试默认参数',
    'system_config.warning_rule.update': '更新预警规则参数',
    'class.student.add': '学生加入班级',
    'class.student.remove': '学生移出班级',
    'class.teacher.add': '添加科任教师',
    'class.teacher.remove': '移除科任教师',
    'class.join_request.submit': '提交入班申请',
    'class.join_request.approve': '通过入班申请',
    'class.join_request.reject': '拒绝入班申请',
    'class.invite_code.reset': '重置邀请码',
    'class.invite_config.update': '更新邀请码配置',
  }
  const targetLabelMap: Record<string, string> = {
    exam: '考试',
    subject: '科目',
    user: '用户',
    system_config: '系统参数',
    class: '班级',
  }

  const renderLogDetail = (row: {
    action: string
    target_type?: string
    target_id?: string
    detail?: Record<string, unknown>
  }) => {
    const detail = row.detail && typeof row.detail === 'object' ? row.detail : {}
    if (row.action === 'exam.create' || row.action === 'exam.update') {
      return `考试「${String(detail.title || '-') }」，班级${Number(detail.classCount || 0)}个，题目${Number(detail.questionCount || 0)}道`
    }
    if (row.action === 'exam.copy') {
      return `从考试ID ${String(detail.sourceExamId || '-')} 复制`
    }
    if (row.action === 'subject.create' || row.action === 'subject.delete') {
      return `科目：${String(detail.name || '-')}`
    }
    if (row.action === 'user.update_status') {
      return Number(detail.status) === 1 ? '账号状态：启用' : '账号状态：禁用'
    }
    if (row.action === 'user.reset_password') {
      return `账号手机号：${String(detail.phone || '-')}`
    }
    if (row.action === 'user.self_profile_update') {
      return detail.avatar_updated ? '已更新姓名或头像' : '已更新姓名'
    }
    if (row.action === 'user.self_password_change') {
      return '用户自行修改登录密码'
    }
    if (row.action === 'system_config.exam_default.update') {
      return `默认时长${String(detail.defaultDurationMinutes || '-')}分钟，每题默认${String(detail.defaultQuestionScore || '-')}分，复制开考提前${String(detail.copyStartOffsetMinutes || '-')}分钟`
    }
    if (row.action === 'system_config.warning_rule.update') {
      return `近${String(detail.recentExamCount || '-')}次，均分阈值${String(detail.avgScoreThreshold || '-')}，未提交阈值${String(detail.missingThreshold || '-')}`
    }
    if (row.action === 'class.student.add' || row.action === 'class.student.remove') {
      return `学生ID：${String(detail.studentId || '-')}，学号：${String(detail.studentNo || '-')}`
    }
    if (row.action === 'class.teacher.add' || row.action === 'class.teacher.remove') {
      return `教师ID：${String(detail.teacherId || '-')}${detail.subjectId ? `，科目ID：${String(detail.subjectId)}` : ''}`
    }
    if (row.action === 'class.join_request.submit') {
      return `申请ID：${String(detail.requestId || '-')}，学号：${String(detail.studentNo || '-')}`
    }
    if (row.action === 'class.join_request.approve' || row.action === 'class.join_request.reject') {
      return `申请ID：${String(detail.requestId || '-')}${detail.studentId ? `，学生ID：${String(detail.studentId)}` : ''}`
    }
    if (row.action === 'class.invite_code.reset') {
      return `邀请码：${String(detail.invite_code || '-')}`
    }
    if (row.action === 'class.invite_config.update') {
      return `启用：${String(detail.inviteEnabled ?? '-') }，审核模式：${String(detail.joinAuditMode || '-')}`
    }
    return '-'
  }

  const exportLogs = () => {
    const fetchRows = async () => {
      if (!CAN_USE_API) return []
      const allRows: Array<{
        id: number
        operator_name: string
        action: string
        target_type?: string
        target_id?: string
        detail?: Record<string, unknown>
        created_at: string
      }> = []
      const pageSize = 200
      let page = 1
      let total: number
      do {
        const query = new URLSearchParams()
        if (logActionFilter) query.set('action', logActionFilter)
        if (logKeyword.trim()) query.set('keyword', logKeyword.trim())
        if (logStartTime) query.set('startTime', logStartTime)
        if (logEndTime) query.set('endTime', logEndTime)
        query.set('page', String(page))
        query.set('pageSize', String(pageSize))
        const response = await fetch(`${API_BASE_URL}/api/operation-logs?${query.toString()}`, {
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.message || `导出查询失败(${response.status})`)
        const batch = Array.isArray(payload?.data) ? payload.data : []
        allRows.push(...batch)
        total = Number(payload?.pagination?.total || 0)
        if (batch.length === 0) break
        page += 1
      } while (allRows.length < total)
      return allRows
    }

    const run = async () => {
      try {
        const sourceRows = await fetchRows()
        const rows = sourceRows.map((row) => ({
          时间: row.created_at ? row.created_at.slice(0, 19).replace('T', ' ') : '',
          操作人: row.operator_name || '系统',
          操作类型: actionLabelMap[row.action] || row.action || '',
          目标模块: row.target_type ? targetLabelMap[row.target_type] || row.target_type : '',
          目标ID: row.target_id || '',
          操作说明: renderLogDetail(row),
        }))
        const sheet = XLSX.utils.json_to_sheet(rows)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, sheet, '操作日志')
        XLSX.writeFile(workbook, `operation_logs_${new Date().toISOString().slice(0, 10)}.xlsx`)
      } catch (error) {
        message.error(error instanceof Error ? error.message : '导出日志失败')
      }
    }

    void run()
  }

  const tabItems: TabsProps['items'] = [
    {
      key: 'subject',
      label: '科目字典',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Input
              placeholder="新增科目名称"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              onPressEnter={createSubject}
              style={{ width: 220 }}
            />
            <Button type="primary" onClick={createSubject}>
              新增科目
            </Button>
            <Button onClick={() => void loadSubjects()}>刷新</Button>
          </Space>
          <List
            loading={subjectLoading}
            dataSource={subjects}
            renderItem={(item) => (
              <List.Item actions={[<Button key="delete" danger type="link" onClick={() => deleteSubject(item.id, item.name)}>删除</Button>]}>
                {item.sort_order}. {item.name}
              </List.Item>
            )}
          />
        </Space>
      ),
    },
    {
      key: 'config',
      label: '参数配置',
      children: (
        <Card loading={configLoading} size="small" title="考试默认参数">
          <Space direction="vertical" style={{ width: '100%' }}>
            <Space>
              <Typography.Text style={{ width: 180 }}>默认考试时长（分钟）</Typography.Text>
              <Input
                type="number"
                min={1}
                value={String(examDefaultConfig.defaultDurationMinutes)}
                onChange={(e) =>
                  setExamDefaultConfig((prev) => ({
                    ...prev,
                    defaultDurationMinutes: Math.max(Number(e.target.value) || 1, 1),
                  }))
                }
                style={{ width: 180 }}
              />
            </Space>
            <Space>
              <Typography.Text style={{ width: 180 }}>默认每题分值</Typography.Text>
              <Input
                type="number"
                min={1}
                value={String(examDefaultConfig.defaultQuestionScore)}
                onChange={(e) =>
                  setExamDefaultConfig((prev) => ({
                    ...prev,
                    defaultQuestionScore: Math.max(Number(e.target.value) || 1, 1),
                  }))
                }
                style={{ width: 180 }}
              />
            </Space>
            <Space>
              <Typography.Text style={{ width: 180 }}>复制考试开考提前（分钟）</Typography.Text>
              <Input
                type="number"
                min={1}
                value={String(examDefaultConfig.copyStartOffsetMinutes)}
                onChange={(e) =>
                  setExamDefaultConfig((prev) => ({
                    ...prev,
                    copyStartOffsetMinutes: Math.max(Number(e.target.value) || 1, 1),
                  }))
                }
                style={{ width: 180 }}
              />
            </Space>
            <Space>
              <Button
                type="primary"
                onClick={async () => {
                  if (!CAN_USE_API) return
                  try {
                    const response = await fetch(`${API_BASE_URL}/api/system-configs/exam-default`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                      },
                      body: JSON.stringify(examDefaultConfig),
                    })
                    const payload = await response.json().catch(() => ({}))
                    if (!response.ok) throw new Error(payload?.message || `保存失败(${response.status})`)
                    message.success('考试默认参数已保存')
                    await loadExamDefaultConfig()
                    await loadLogs({
                      action: logActionFilter,
                      keyword: logKeyword.trim(),
                      startTime: logStartTime,
                      endTime: logEndTime,
                      page: logPage,
                      pageSize: logPageSize,
                    })
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : '保存考试默认参数失败')
                  }
                }}
              >
                保存参数
              </Button>
              <Button
                onClick={() => {
                  void loadExamDefaultConfig()
                  void loadWarningRuleConfig()
                }}
              >
                重新加载
              </Button>
            </Space>
            <Typography.Title level={5} style={{ margin: '8px 0 0' }}>
              学生预警规则参数
            </Typography.Title>
            <Space>
              <Typography.Text style={{ width: 180 }}>统计最近考试次数</Typography.Text>
              <Input
                type="number"
                min={3}
                max={12}
                value={String(warningRuleConfig.recentExamCount)}
                onChange={(e) =>
                  setWarningRuleConfig((prev) => ({
                    ...prev,
                    recentExamCount: Math.min(Math.max(Number(e.target.value) || 3, 3), 12),
                  }))
                }
                style={{ width: 180 }}
              />
            </Space>
            <Space>
              <Typography.Text style={{ width: 180 }}>平均分预警阈值</Typography.Text>
              <Input
                type="number"
                min={0}
                value={String(warningRuleConfig.avgScoreThreshold)}
                onChange={(e) =>
                  setWarningRuleConfig((prev) => ({
                    ...prev,
                    avgScoreThreshold: Math.max(Number(e.target.value) || 0, 0),
                  }))
                }
                style={{ width: 180 }}
              />
            </Space>
            <Space>
              <Typography.Text style={{ width: 180 }}>未提交次数阈值</Typography.Text>
              <Input
                type="number"
                min={1}
                value={String(warningRuleConfig.missingThreshold)}
                onChange={(e) =>
                  setWarningRuleConfig((prev) => ({
                    ...prev,
                    missingThreshold: Math.max(Number(e.target.value) || 1, 1),
                  }))
                }
                style={{ width: 180 }}
              />
            </Space>
            <Space>
              <Button
                type="primary"
                onClick={async () => {
                  if (!CAN_USE_API) return
                  try {
                    const response = await fetch(`${API_BASE_URL}/api/system-configs/warning-rule`, {
                      method: 'PUT',
                      headers: {
                        'Content-Type': 'application/json',
                        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
                      },
                      body: JSON.stringify(warningRuleConfig),
                    })
                    const payload = await response.json().catch(() => ({}))
                    if (!response.ok) throw new Error(payload?.message || `保存失败(${response.status})`)
                    message.success('预警规则参数已保存')
                    await loadWarningRuleConfig()
                    await loadLogs({
                      action: logActionFilter,
                      keyword: logKeyword.trim(),
                      startTime: logStartTime,
                      endTime: logEndTime,
                      page: logPage,
                      pageSize: logPageSize,
                    })
                  } catch (error) {
                    message.error(error instanceof Error ? error.message : '保存预警规则参数失败')
                  }
                }}
              >
                保存预警规则
              </Button>
            </Space>
          </Space>
        </Card>
      ),
    },
    {
      key: 'logs',
      label: '操作日志',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Space>
            <Select
              allowClear
              placeholder="操作类型"
              style={{ width: 220 }}
              value={logActionFilter}
              onChange={(value) => setLogActionFilter(value)}
              options={[
                { value: 'exam.create', label: '考试创建' },
                { value: 'exam.update', label: '考试编辑' },
                { value: 'exam.publish', label: '考试发布' },
                { value: 'exam.finish', label: '考试提前结束' },
                { value: 'exam.reopen', label: '考试再开启' },
                { value: 'exam.copy', label: '考试复制' },
                { value: 'exam.delete', label: '考试删除' },
                { value: 'subject.create', label: '科目新增' },
                { value: 'subject.delete', label: '科目删除' },
                { value: 'user.reset_password', label: '重置密码' },
                { value: 'user.update_status', label: '账号状态修改' },
                { value: 'system_config.exam_default.update', label: '更新考试默认参数' },
                { value: 'system_config.warning_rule.update', label: '更新预警规则参数' },
                { value: 'class.student.add', label: '学生加入班级' },
                { value: 'class.student.remove', label: '学生移出班级' },
                { value: 'class.teacher.add', label: '添加科任教师' },
                { value: 'class.teacher.remove', label: '移除科任教师' },
                { value: 'class.join_request.submit', label: '提交入班申请' },
                { value: 'class.join_request.approve', label: '通过入班申请' },
                { value: 'class.join_request.reject', label: '拒绝入班申请' },
                { value: 'class.invite_code.reset', label: '重置邀请码' },
                { value: 'class.invite_config.update', label: '更新邀请码配置' },
              ]}
            />
            <Input
              value={logKeyword}
              onChange={(e) => setLogKeyword(e.target.value)}
              placeholder="操作人/模块关键词"
              style={{ width: 220 }}
              allowClear
              onPressEnter={() => void loadLogs({ action: logActionFilter, keyword: logKeyword.trim(), startTime: logStartTime, endTime: logEndTime, page: 1 })}
            />
            <Input
              type="datetime-local"
              value={logStartTime}
              onChange={(e) => setLogStartTime(e.target.value)}
              style={{ width: 200 }}
              placeholder="开始时间"
            />
            <Input
              type="datetime-local"
              value={logEndTime}
              onChange={(e) => setLogEndTime(e.target.value)}
              style={{ width: 200 }}
              placeholder="结束时间"
            />
            <Button
              type="primary"
              onClick={() => void loadLogs({ action: logActionFilter, keyword: logKeyword.trim(), startTime: logStartTime, endTime: logEndTime, page: 1 })}
            >
              查询
            </Button>
            <Button
              onClick={() => {
                setLogActionFilter(undefined)
                setLogKeyword('')
                setLogStartTime('')
                setLogEndTime('')
                setLogPage(1)
                void loadLogs({ action: '', keyword: '', startTime: '', endTime: '', page: 1 })
              }}
            >
              重置
            </Button>
            <Button onClick={exportLogs}>导出日志</Button>
          </Space>
          <Table
            loading={logLoading}
            rowKey={(row: Record<string, unknown>) => String(row.id ?? '')}
            pagination={{
              current: logPage,
              pageSize: logPageSize,
              total: logTotal,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (page, pageSize) => {
                void loadLogs({
                  action: logActionFilter,
                  keyword: logKeyword.trim(),
                  startTime: logStartTime,
                  endTime: logEndTime,
                  page,
                  pageSize,
                })
              },
            }}
            columns={[
              {
                title: '时间',
                dataIndex: 'created_at',
                width: 170,
                render: (value: string) => (value ? value.slice(0, 19).replace('T', ' ') : '-'),
              },
              { title: '操作人', dataIndex: 'operator_name', width: 120 },
              {
                title: '操作类型',
                dataIndex: 'action',
                width: 180,
                render: (value: string) => actionLabelMap[value] || value || '-',
              },
              {
                title: '目标模块',
                dataIndex: 'target_type',
                width: 120,
                render: (value?: string) => (value ? targetLabelMap[value] || value : '-'),
              },
              { title: '目标ID', dataIndex: 'target_id', width: 120 },
              {
                title: '操作说明',
                key: 'detail',
                render: (_: unknown, row: {
                  action: string
                  target_type?: string
                  target_id?: string
                  detail?: Record<string, unknown>
                }) => <Typography.Text>{renderLogDetail(row)}</Typography.Text>,
              },
            ]}
            dataSource={logRows}
          />
        </Space>
      ),
    },
  ]

  return <Card title="系统设置（管理员）"><Tabs items={tabItems} /></Card>
}

function AppLayout({
  themeIndex,
  onNextTheme,
  onChangeTheme,
  onLogout,
  onAuthUserUpdate,
  authUser,
}: {
  themeIndex: number
  onNextTheme: () => void
  onChangeTheme: (index: number) => void
  onLogout: () => void
  onAuthUserUpdate: (user: AuthUser) => void
  authUser: AuthUser
}) {
  const role = useMemo(() => resolveEffectiveRole(authUser.roles), [authUser.roles])
  const location = useLocation()
  const navigate = useNavigate()
  const currentTheme = themeOptions[themeIndex]
  const authToken = localStorage.getItem(AUTH_TOKEN_KEY) || ''
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [pwdSaving, setPwdSaving] = useState(false)
  const [profileForm] = Form.useForm()
  const [pwdForm] = Form.useForm()
  const watchedAvatarUrl = Form.useWatch('avatarUrl', profileForm)

  const loadProfile = async () => {
    if (!CAN_USE_API) return
    try {
      setProfileLoading(true)
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `加载个人信息失败(${response.status})`)
      const data = payload?.data as Record<string, unknown> | undefined
      if (!data) throw new Error('个人信息数据为空')
      profileForm.setFieldsValue({
        name: String(data.name || ''),
        phone: String(data.phone || ''),
        avatarUrl: String(data.avatarUrl || ''),
      })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载个人信息失败')
    } finally {
      setProfileLoading(false)
    }
  }

  useEffect(() => {
    if (profileOpen) void loadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileOpen])

  const submitProfile = async () => {
    if (!CAN_USE_API) return
    try {
      const values = await profileForm.validateFields()
      setProfileSaving(true)
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          name: String(values.name || '').trim(),
          avatarUrl: String(values.avatarUrl || '').trim(),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `保存失败(${response.status})`)
      const data = payload?.data as AuthUser | undefined
      if (!data) throw new Error('保存响应异常')
      onAuthUserUpdate({
        ...authUser,
        name: data.name,
        avatarUrl: data.avatarUrl || '',
        roles: Array.isArray(data.roles) ? data.roles : authUser.roles,
      })
      message.success('个人信息已更新')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setProfileSaving(false)
    }
  }

  const submitPassword = async () => {
    if (!CAN_USE_API) return
    try {
      const values = await pwdForm.validateFields()
      if (values.newPassword !== values.confirmPassword) {
        message.error('两次输入的新密码不一致')
        return
      }
      setPwdSaving(true)
      const response = await fetch(`${API_BASE_URL}/api/auth/me/password`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          currentPassword: String(values.currentPassword || ''),
          newPassword: String(values.newPassword || ''),
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || `修改密码失败(${response.status})`)
      pwdForm.resetFields()
      message.success('密码已修改，请牢记新密码')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '修改密码失败')
    } finally {
      setPwdSaving(false)
    }
  }

  const avatarUploadProps: UploadProps = {
    name: 'file',
    maxCount: 1,
    showUploadList: false,
    customRequest: async (options) => {
      if (!CAN_USE_API) return
      const file = options.file as File
      const formData = new FormData()
      formData.append('file', file)
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/me/avatar-upload`, {
          method: 'POST',
          headers: authToken ? { Authorization: `Bearer ${authToken}` } : undefined,
          body: formData,
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload?.message || `上传失败(${response.status})`)
        const url = String(payload?.data?.avatarUrl || '')
        if (!url) throw new Error('未返回头像地址')
        profileForm.setFieldValue('avatarUrl', url)
        options.onSuccess?.(payload, file)
        message.success('头像已上传，请点击下方「保存」生效')
      } catch (error) {
        options.onError?.(error as Error)
        message.error(error instanceof Error ? error.message : '上传失败')
      }
    },
  }

  const avatarSrc = authUser.avatarUrl?.trim() ? authUser.avatarUrl.trim() : undefined
  const userMenuPopover = (
    <div style={{ minWidth: 168 }}>
      <Space direction="vertical" size={4} style={{ width: '100%' }}>
        <Button
          type="text"
          block
          style={{ textAlign: 'left' }}
          onClick={() => {
            setProfileOpen(true)
          }}
        >
          个人中心
        </Button>
        <Button
          type="text"
          block
          danger
          style={{ textAlign: 'left' }}
          icon={<LogoutOutlined />}
          onClick={() => {
            onLogout()
            navigate('/login', { replace: true })
          }}
        >
          退出登录
        </Button>
      </Space>
    </div>
  )

  const menuItems: MenuProps['items'] = useMemo(() => {
    const common = [{ key: '/dashboard', icon: <AppstoreOutlined />, label: '概览' }]
    const classTeacher = [
      { key: '/teacher-accounts', icon: <UserOutlined />, label: '教师账号管理' },
      { key: '/classes', icon: <TeamOutlined />, label: '班级管理' },
      { key: '/analytics', icon: <BarChartOutlined />, label: '学情分析' },
      { key: '/resources', icon: <FolderOpenOutlined />, label: '资料库' },
    ]
    const subjectTeacher = [
      { key: '/classes', icon: <TeamOutlined />, label: '班级管理' },
      { key: '/question-bank', icon: <ReadOutlined />, label: '题库中心' },
      { key: '/exams', icon: <BookOutlined />, label: '考试管理' },
      { key: '/analytics', icon: <BarChartOutlined />, label: '学情分析' },
      { key: '/resources', icon: <FolderOpenOutlined />, label: '资料库' },
    ]
    if (role === 'admin')
      return [
        ...common,
        ...classTeacher,
        { key: '/question-bank', icon: <ReadOutlined />, label: '题库中心' },
        { key: '/exams', icon: <BookOutlined />, label: '考试管理' },
        { key: '/system-settings', icon: <FileProtectOutlined />, label: '系统设置' },
      ]
    if (role === 'class_teacher') return [...common, ...classTeacher]
    if (role === 'subject_teacher') return [...common, ...subjectTeacher]
    return [...common, ...classTeacher, ...subjectTeacher, { key: '/system-settings', icon: <FileProtectOutlined />, label: '系统设置' }]
  }, [role])

  const currentMenu = menuItems?.find((item) => item && 'key' in item && item.key === location.pathname)
  const currentTitle = currentMenu && 'label' in currentMenu ? currentMenu.label : '模块'
  const themePickerContent = (
    <div className="theme-picker-popover">
      {themeOptions.map((theme, index) => (
        <button
          key={theme.key}
          type="button"
          className={`theme-dot ${index === themeIndex ? 'active' : ''}`}
          style={{ backgroundColor: theme.primary }}
          title={theme.name}
          onClick={() => onChangeTheme(index)}
        />
      ))}
    </div>
  )

  return (
    <Layout className="app-layout">
      <Sider width={240} theme="light" className="app-sider">
        <div className="logo-box">题灵智库管理系统</div>
        <Menu mode="inline" selectedKeys={[location.pathname]} items={menuItems} onClick={(e) => navigate(e.key)} />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Typography.Text strong>题灵智库管理系统 / {currentTitle}</Typography.Text>
          <Space>
            <Popover
              trigger="hover"
              placement="bottomRight"
              content={themePickerContent}
              title={`主题色：${currentTheme.name}`}
            >
              <Button icon={<BgColorsOutlined />} onClick={onNextTheme}>
                一键换肤
              </Button>
            </Popover>
            <Popover trigger="hover" placement="bottomRight" content={userMenuPopover}>
              <Space style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 8 }} align="center">
                <Avatar src={avatarSrc} icon={!avatarSrc ? <UserOutlined /> : undefined} />
                <Typography.Text>{authUser.name}</Typography.Text>
                <DownOutlined style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }} />
              </Space>
            </Popover>
          </Space>
        </Header>
        <Drawer
          title="个人中心"
          width={420}
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          destroyOnClose={false}
        >
          <Tabs
            items={[
              {
                key: 'profile',
                label: '基本资料',
                children: (
                  <Spin spinning={profileLoading}>
                    <Space direction="vertical" style={{ width: '100%' }} size={16}>
                      <div style={{ textAlign: 'center' }}>
                        <Avatar size={80} src={(watchedAvatarUrl as string | undefined) || avatarSrc} icon={<UserOutlined />} />
                      </div>
                      <Upload {...avatarUploadProps}>
                        <Button>上传头像</Button>
                      </Upload>
                      <Typography.Text type="secondary">支持 PNG/JPG/WebP/GIF，最大 2MB；上传后请点击保存。</Typography.Text>
                      <Form form={profileForm} layout="vertical" preserve={false}>
                        <Form.Item name="avatarUrl" hidden>
                          <Input />
                        </Form.Item>
                        <Form.Item name="name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
                          <Input maxLength={64} />
                        </Form.Item>
                        <Form.Item name="phone" label="手机号">
                          <Input disabled />
                        </Form.Item>
                        <Button type="primary" loading={profileSaving} onClick={() => void submitProfile()}>
                          保存资料
                        </Button>
                      </Form>
                    </Space>
                  </Spin>
                ),
              },
              {
                key: 'password',
                label: '安全设置',
                children: (
                  <Form form={pwdForm} layout="vertical">
                    <Form.Item name="currentPassword" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
                      <Input.Password autoComplete="current-password" />
                    </Form.Item>
                    <Form.Item
                      name="newPassword"
                      label="新密码"
                      rules={[
                        { required: true, message: '请输入新密码' },
                        { min: 6, message: '新密码至少 6 位' },
                      ]}
                    >
                      <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Form.Item
                      name="confirmPassword"
                      label="确认新密码"
                      dependencies={['newPassword']}
                      rules={[
                        { required: true, message: '请再次输入新密码' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (!value || getFieldValue('newPassword') === value) {
                              return Promise.resolve()
                            }
                            return Promise.reject(new Error('两次输入的新密码不一致'))
                          },
                        }),
                      ]}
                    >
                      <Input.Password autoComplete="new-password" />
                    </Form.Item>
                    <Button type="primary" loading={pwdSaving} onClick={() => void submitPassword()}>
                      修改密码
                    </Button>
                  </Form>
                ),
              },
            ]}
          />
        </Drawer>
        <Content className="app-content">
          <Routes>
            <Route path="/dashboard" element={<DashboardPage role={role} themePrimary={currentTheme.primary} />} />
            <Route path="/teacher-accounts" element={<TeacherAccountsPage authUser={authUser} />} />
            <Route path="/classes" element={<ClassPage />} />
            <Route path="/question-bank" element={<QuestionBankPage />} />
            <Route path="/exams" element={<ExamPage />} />
            <Route path="/exams/:examId" element={<ExamDetailPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/resources" element={<ResourcePage authUser={authUser} />} />
            <Route path="/system-settings" element={<SystemSettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

function App() {
  const [authToken, setAuthToken] = useState<string>(() => localStorage.getItem(AUTH_TOKEN_KEY) || '')
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(AUTH_USER_KEY)
    if (!raw) return null
    try {
      return JSON.parse(raw) as AuthUser
    } catch {
      return null
    }
  })
  const [themeIndex, setThemeIndex] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_THEME_INDEX))
    return Number.isNaN(saved) ? 0 : Math.min(Math.max(saved, 0), themeOptions.length - 1)
  })
  const currentTheme = themeOptions[themeIndex]

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--color-primary', currentTheme.primary)
    root.style.setProperty('--color-primary-hover', currentTheme.primaryHover)
    root.style.setProperty('--color-bg-page', currentTheme.pageBg)
    root.style.setProperty('--color-bg-card', currentTheme.cardBg)
    root.style.setProperty('--color-page-tint', currentTheme.pageTint)
    root.style.setProperty('--color-header-bg', currentTheme.headerBg)
    root.style.setProperty('--color-sider-bg', currentTheme.siderBg)
    root.style.setProperty('--color-table-bg', currentTheme.tableBg)
    root.style.setProperty('--color-menu-active-bg', currentTheme.menuActiveBg)
    root.style.setProperty('--color-menu-hover-bg', currentTheme.menuHoverBg)
    root.style.setProperty('--color-tag-bg', currentTheme.tagBg)
    root.style.setProperty('--color-badge-bg', currentTheme.badgeBg)
    root.style.setProperty('--color-table-hover-bg', currentTheme.tableHoverBg)
    root.style.setProperty('--color-input-focus-ring', currentTheme.inputFocusRing)
    root.style.setProperty('--color-modal-header-bg', currentTheme.modalHeaderBg)
    root.style.setProperty('--color-pagination-active-bg', currentTheme.paginationActiveBg)
    root.style.setProperty('--color-progress-trail', currentTheme.progressTrailColor)
    root.style.setProperty('--color-sider-border', currentTheme.pageTint)
    root.style.setProperty('--color-header-border', currentTheme.pageTint)
    root.style.setProperty('--color-text-main', '#0f172a')
    root.style.setProperty('--color-dot-border', '#d9d9d9')
  }, [currentTheme])

  useEffect(() => {
    localStorage.setItem(STORAGE_THEME_INDEX, String(themeIndex))
  }, [themeIndex])

  const handleNextTheme = () => {
    setThemeIndex((prev) => (prev + 1) % themeOptions.length)
  }

  const handleLoginSuccess = (token: string, user: AuthUser) => {
    setAuthToken(token)
    setAuthUser(user)
    localStorage.setItem(AUTH_TOKEN_KEY, token)
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
  }

  const handleLogout = () => {
    setAuthToken('')
    setAuthUser(null)
    localStorage.removeItem(AUTH_TOKEN_KEY)
    localStorage.removeItem(AUTH_USER_KEY)
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: currentTheme.primary,
          borderRadius: 10,
        },
      }}
    >
      <Routes>
        <Route
          path="/login"
          element={authToken && authUser ? <Navigate to="/dashboard" replace /> : <LoginPage onLoginSuccess={handleLoginSuccess} />}
        />
        <Route
          path="/*"
          element={
            authToken && authUser ? (
              <AppLayout
                themeIndex={themeIndex}
                onNextTheme={handleNextTheme}
                onChangeTheme={setThemeIndex}
                onLogout={handleLogout}
                onAuthUserUpdate={(user) => {
                  setAuthUser(user)
                  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user))
                }}
                authUser={authUser}
              />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
    </ConfigProvider>
  )
}

export default App
