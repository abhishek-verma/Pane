import { homedir } from 'node:os'
import { join } from 'node:path'
import { getDbHandle, initializeDb } from '../src/lib/db'

initializeDb({
  dbPath: join(homedir(), '.browseros-dev', 'db', 'browseros.sqlite'),
})

try {
  const db = getDbHandle().sqlite

  console.log('=== Graph Nodes ===')
  const nodes = db
    .prepare(
      'SELECT id, kind, title, uri, provenance FROM graph_nodes ORDER BY rowid DESC LIMIT 20',
    )
    .all()
  console.log(JSON.stringify(nodes, null, 2))

  console.log('\n=== Skills ===')
  const skills = db
    .prepare('SELECT id, name, status FROM skills ORDER BY rowid DESC LIMIT 20')
    .all()
  console.log(JSON.stringify(skills, null, 2))

  console.log('\n=== Research Threads ===')
  const threads = db.prepare('SELECT * FROM research_threads LIMIT 10').all()
  console.log(JSON.stringify(threads, null, 2))

  console.log('\n=== Research Thread Pages ===')
  const pages = db.prepare('SELECT * FROM research_thread_pages LIMIT 20').all()
  console.log(JSON.stringify(pages, null, 2))
} catch (err) {
  console.error('Error querying DB:', err)
}
