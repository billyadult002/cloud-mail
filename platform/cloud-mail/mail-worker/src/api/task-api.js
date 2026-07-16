// Loop 4 (Copilot Mail -> Task) API. Mounted under the v2 surface via webs.js.
// Mirrors the star-api convention: userContext for auth, result.ok() envelope.
import app from '../hono/hono';
import taskService from '../service/task-service';
import userContext from '../security/user-context';
import result from '../model/result';

// Create a task (optionally backlinked via body.sourceEmailId).
app.post('/api/v2/tasks', async (c) => {
	const data = await taskService.create(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

// Create a task from a specific owned email (ownership-checked).
app.post('/api/v2/tasks/from-email', async (c) => {
	const data = await taskService.createFromEmail(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

// List the user's tasks (optional ?status=&size=).
app.get('/api/v2/tasks', async (c) => {
	const data = await taskService.list(c, c.req.query(), userContext.getUserId(c));
	return c.json(result.ok(data));
});

// Tasks backlinked to a given email (Copilot panel).
app.get('/api/v2/tasks/for-email/:emailId', async (c) => {
	const data = await taskService.listForEmail(c, c.req.param('emailId'), userContext.getUserId(c));
	return c.json(result.ok(data));
});

// Update a task's status (open/done/cancelled).
app.post('/api/v2/tasks/status', async (c) => {
	const data = await taskService.updateStatus(c, await c.req.json(), userContext.getUserId(c));
	return c.json(result.ok(data));
});
