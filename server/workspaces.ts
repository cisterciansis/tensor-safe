import { z } from 'zod';
import { nameSchema, emptyState } from '@/lib/domain';
import {
  auditBinding,
  body,
  db,
  failure,
  identity,
  noCache,
  seal,
} from '@/lib/server';
export async function listWorkspaces(request: Request) {
  try {
    const user = await identity(request);
    const rows = await db()
      .prepare(
        'SELECT DISTINCT w.id,w.name,w.version FROM workspaces w LEFT JOIN members m ON m.workspace_id=w.id WHERE w.owner=? OR m.user_id=? ORDER BY w.name',
      )
      .bind(user.userId, user.userId)
      .all();
    return Response.json(
      {
        workspaces: rows.results,
        user: { id: user.userId, name: user.displayName },
      },
      { headers: noCache },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function createWorkspace(request: Request) {
  try {
    const user = await identity(request);
    const { name } = z
      .object({ name: nameSchema })
      .strict()
      .parse(await body(request));
    const count = await db()
      .prepare('SELECT count(*) AS n FROM workspaces WHERE owner=?')
      .bind(user.userId)
      .first<{ n: number }>();
    if ((count?.n ?? 0) >= 30) throw Error('Workspace limit reached');
    const id = crypto.randomUUID();
    await db().batch([
      db()
        .prepare(
          'INSERT INTO workspaces(id,owner,name,state,mutation) VALUES(?,?,?,?,?)',
        )
        .bind(
          id,
          user.userId,
          name,
          seal(JSON.stringify(emptyState()), `${id}:state`),
          id,
        ),
      db()
        .prepare(
          'INSERT INTO audit(id,workspace_id,actor,action,version,created_at,details) VALUES(?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          id,
          user.userId,
          'createWorkspace',
          0,
          new Date().toISOString(),
          seal(
            JSON.stringify({ name }),
            auditBinding(id, id, 0, user.userId, 'createWorkspace'),
          ),
        ),
    ]);
    return Response.json({ id }, { status: 201, headers: noCache });
  } catch (e) {
    return failure(e);
  }
}
