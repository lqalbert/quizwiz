/** 超过该秒数未心跳，视为已离线 */
export const ONLINE_HEARTBEAT_STALE_SECONDS = 120

/** 跨自然日：昨夜无心跳延续时，今日从「今日首次活跃」起算，而非 0 点 */
export const ONLINE_CROSS_MIDNIGHT_GAP_SECONDS = 90 * 60

/**
 * 会话在统计窗口内的有效结束时刻：
 * - 已结束：ended_at（用户切出）
 * - 进行中：NOW()
 * - 僵尸：末次心跳
 */
export const onlineSessionEffectiveEndSql = (alias = 'sos', windowEndSql = 'NOW()') => `CASE
  WHEN ${alias}.ended_at IS NOT NULL THEN LEAST(${alias}.ended_at, ${windowEndSql})
  WHEN COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at)
    < NOW() - (${ONLINE_HEARTBEAT_STALE_SECONDS} * INTERVAL '1 second')
    THEN LEAST(COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at), ${windowEndSql})
  ELSE LEAST(NOW(), ${windowEndSql})
END`

/**
 * 自然日窗口内重叠起点：
 * - 当日开始会话：started_at
 * - 昨夜会话今日首次活跃（间隔>90min）：今日首次心跳附近
 * - 真正跨凌晨连续在线：当日 00:00
 */
export const onlineSessionOverlapStartSql = (startSql, endSql) => `CASE
  WHEN sos.started_at >= ${endSql} THEN ${endSql}
  WHEN (timezone('Asia/Shanghai', sos.started_at))::date = (timezone('Asia/Shanghai', ${startSql}))::date
    THEN GREATEST(sos.started_at, ${startSql})
  WHEN COALESCE(sos.last_heartbeat_at, sos.started_at) < ${startSql}
    THEN ${endSql}
  WHEN (
    ${startSql} - GREATEST(
      sos.started_at,
      COALESCE(
        CASE WHEN sos.last_heartbeat_at < ${startSql} THEN sos.last_heartbeat_at END,
        sos.started_at
      )
    )
  ) > (${ONLINE_CROSS_MIDNIGHT_GAP_SECONDS} * INTERVAL '1 second')
    THEN GREATEST(
      ${startSql},
      LEAST(
        COALESCE(sos.last_heartbeat_at, (${onlineSessionEffectiveEndSql('sos', endSql)})),
        (${onlineSessionEffectiveEndSql('sos', endSql)})
      )
    )
  ELSE GREATEST(sos.started_at, ${startSql})
END`

/** 自然日重叠秒数 */
export const onlineSessionOverlapSecondsSql = (startSql, endSql) => `CASE
  WHEN sos.started_at >= ${endSql} THEN 0
  WHEN (${onlineSessionEffectiveEndSql('sos', endSql)}) <= ${startSql} THEN 0
  ELSE GREATEST(0, EXTRACT(EPOCH FROM (
    LEAST((${onlineSessionEffectiveEndSql('sos', endSql)}), ${endSql})
    - (${onlineSessionOverlapStartSql(startSql, endSql)})
  ))::int)
END`

export const onlineSessionIntersectsWindowSql = (startSql, endSql) => `(
  sos.started_at < ${endSql}
  AND (${onlineSessionEffectiveEndSql('sos', endSql)}) > ${startSql}
  AND (${onlineSessionOverlapStartSql(startSql, endSql)}) < LEAST(
    (${onlineSessionEffectiveEndSql('sos', endSql)}),
    ${endSql}
  )
)`

export const onlineSessionNaturalDayOverlapExpr = (dayStartSql, dayEndSql) =>
  onlineSessionOverlapSecondsSql(dayStartSql, dayEndSql)

export const onlineSessionCloseEndedAtSql = (alias = 'sos') => `CASE
  WHEN COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at)
    < NOW() - (${ONLINE_HEARTBEAT_STALE_SECONDS} * INTERVAL '1 second')
    THEN COALESCE(${alias}.last_heartbeat_at, ${alias}.started_at)
  ELSE NOW()
END`

/** 指定上海日历日的统计窗口 [startSql, endSql) */
export const getShanghaiCalendarDayWindowSql = (dayStr) => ({
  startSql: `('${dayStr}'::date::timestamp AT TIME ZONE 'Asia/Shanghai')`,
  endSql: `(('${dayStr}'::date + 1)::timestamp AT TIME ZONE 'Asia/Shanghai')`,
})

export const buildOnlineDaySessionExprs = (dayStr) => {
  const { startSql, endSql } = getShanghaiCalendarDayWindowSql(dayStr)
  return {
    startSql,
    endSql,
    overlapStartSql: onlineSessionOverlapStartSql(startSql, endSql),
    effectiveEndSql: onlineSessionEffectiveEndSql('sos', endSql),
    overlapSecondsSql: onlineSessionOverlapSecondsSql(startSql, endSql),
    intersectSql: onlineSessionIntersectsWindowSql(startSql, endSql),
  }
}

/** 某学生在指定日的会话明细（与班级统计、时间轴同口径） */
export const queryStudentOnlineSessionsForDay = async (executor, studentId, dayStr) => {
  const { endSql, overlapStartSql, effectiveEndSql, overlapSecondsSql, intersectSql } =
    buildOnlineDaySessionExprs(dayStr)
  return executor.query(
    `
    SELECT
      sos.id,
      sos.started_at,
      sos.ended_at,
      sos.duration_seconds,
      sos.last_heartbeat_at,
      (${overlapStartSql}) AS clip_start,
      LEAST((${effectiveEndSql}), ${endSql}) AS clip_end,
      (${overlapSecondsSql})::int AS overlap_seconds
    FROM student_online_sessions sos
    WHERE sos.student_id = $1
      AND ${intersectSql}
    ORDER BY sos.started_at ASC
    `,
    [studentId],
  )
}

/** 按上海自然日切分会话，重建 student_online_day（仅已结束会话） */
export const rebuildAllStudentOnlineDayFromSessions = async (client) => {
  await client.query(`DELETE FROM student_online_day`)
  await client.query(
    `
    INSERT INTO student_online_day (student_id, online_date, total_seconds, session_count)
    SELECT
      sos.student_id,
      d.online_date,
      SUM(
        ${onlineSessionNaturalDayOverlapExpr(
          '(d.online_date::timestamp AT TIME ZONE \'Asia/Shanghai\')',
          '((d.online_date + 1)::timestamp AT TIME ZONE \'Asia/Shanghai\')',
        )}
      )::int AS total_seconds,
      COUNT(*) FILTER (
        WHERE ${onlineSessionNaturalDayOverlapExpr(
          '(d.online_date::timestamp AT TIME ZONE \'Asia/Shanghai\')',
          '((d.online_date + 1)::timestamp AT TIME ZONE \'Asia/Shanghai\')',
        )} > 0
      )::int AS session_count
    FROM student_online_sessions sos
    CROSS JOIN LATERAL (
      SELECT generate_series(
        (timezone('Asia/Shanghai', sos.started_at))::date,
        (timezone('Asia/Shanghai', sos.ended_at))::date,
        interval '1 day'
      )::date AS online_date
    ) d
    WHERE sos.ended_at IS NOT NULL
      AND sos.ended_at > sos.started_at
    GROUP BY sos.student_id, d.online_date
    HAVING SUM(
      ${onlineSessionNaturalDayOverlapExpr(
        '(d.online_date::timestamp AT TIME ZONE \'Asia/Shanghai\')',
        '((d.online_date + 1)::timestamp AT TIME ZONE \'Asia/Shanghai\')',
      )}
    ) > 0
    `,
  )
}
