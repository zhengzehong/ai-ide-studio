import type { Migration } from '../migrator.js'

/**
 * 修复"线 × 成员"格子矩阵的存量缺口：
 * 1) 活跃会话线里缺席的成员补登记格子（中途召唤的成员此前掉出所有已有会话线）：
 *    - leader 一律使用该线 master_session_id 作为格子 session，维持
 *      "leader 格子 = 会话线 master" 不变量（避免存量线 master 变成无格子指向的挂名 session）；
 *    - 普通成员复用其 primary session（team_members.session_id），但要求该 session
 *      从未有消息（last_message_at IS NULL），与运行时 resolveMemberConversationSession
 *      的复用规则一致；primary 已有历史的成员不在此处补格子，交由运行时自愈。
 * 2) team_members.session_id 若不属于任何活跃格子（第一期遗留的孤儿 master，如唤醒误投的
 *    常驻会话），对齐为该成员所在最近活跃会话线的格子 session；孤儿 session 保留不删。
 */
export const teamSessionGridRepairMigration: Migration = {
  version: '068',
  name: 'team_session_grid_repair',
  up(db) {
    db.exec(`
      INSERT INTO team_conversation_members (conversation_id, member_id, session_id, joined_at, left_at)
      SELECT tc.id, tm.id,
        CASE WHEN tm.role = 'leader' THEN tc.master_session_id ELSE tm.session_id END,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
      FROM team_conversations tc
      JOIN team_members tm ON tm.team_id = tc.team_id
      WHERE tc.status = 'active'
        AND tm.status = 'active'
        AND tm.session_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM team_conversation_members x
          WHERE x.conversation_id = tc.id AND x.member_id = tm.id AND x.left_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM team_conversation_members y
          JOIN team_conversations tc2 ON tc2.id = y.conversation_id
          WHERE y.member_id = tm.id AND y.left_at IS NULL AND tc2.status = 'active' AND y.session_id IS NOT NULL
        )
        AND (
          tm.role = 'leader'
          OR EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.id = tm.session_id AND s.last_message_at IS NULL
          )
        );

      UPDATE team_members
      SET session_id = (
        SELECT tc.master_session_id FROM team_conversations tc
        WHERE tc.team_id = team_members.team_id AND tc.status = 'active'
        ORDER BY tc.updated_at DESC, tc.created_at DESC LIMIT 1
      )
      WHERE role = 'leader'
        AND session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM team_conversations tc3
          WHERE tc3.team_id = team_members.team_id AND tc3.status = 'active'
        )
        AND NOT EXISTS (
          SELECT 1 FROM team_conversation_members tcm
          JOIN team_conversations tc ON tc.id = tcm.conversation_id
          WHERE tcm.session_id = team_members.session_id
            AND tcm.left_at IS NULL AND tc.status = 'active'
        );

      UPDATE team_members
      SET session_id = (
        SELECT tcm.session_id FROM team_conversation_members tcm
        JOIN team_conversations tc ON tc.id = tcm.conversation_id
        WHERE tc.team_id = team_members.team_id
          AND tc.status = 'active'
          AND tcm.member_id = team_members.id
          AND tcm.session_id IS NOT NULL
        ORDER BY tc.updated_at DESC, tc.created_at DESC LIMIT 1
      )
      WHERE role != 'leader'
        AND session_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM team_conversation_members tcm2
          JOIN team_conversations tc2 ON tc2.id = tcm2.conversation_id
          WHERE tc2.team_id = team_members.team_id AND tc2.status = 'active'
            AND tcm2.member_id = team_members.id AND tcm2.session_id IS NOT NULL AND tcm2.left_at IS NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM team_conversation_members tcm
          JOIN team_conversations tc ON tc.id = tcm.conversation_id
          WHERE tcm.session_id = team_members.session_id
            AND tcm.left_at IS NULL AND tc.status = 'active'
        );
    `)
  },
}
