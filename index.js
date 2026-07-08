const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


app.get('/api/categories', (req, res) => {
  db.all(`
    SELECT 
      c.id,
      c.name,
      c.monthly_budget,
      COALESCE(SUM(e.amount), 0) as total_spent
    FROM categories c
    LEFT JOIN expenses e ON c.id = e.category_id
      AND strftime('%Y-%m', e.date) = strftime('%Y-%m', 'now')
    GROUP BY c.id, c.name, c.monthly_budget
    ORDER BY c.name
  `, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});


app.post('/api/categories', (req, res) => {
  const { name, monthly_budget } = req.body;


  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Category name is required' });
  }

  const budget = monthly_budget ? parseFloat(monthly_budget) : null;
  if (budget !== null && (isNaN(budget) || budget < 0)) {
    return res.status(400).json({ error: 'Monthly budget must be a non-negative number' });
  }

  db.run(
    'INSERT INTO categories (name, monthly_budget) VALUES (?, ?)',
    [name.trim(), budget],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ error: 'Category already exists' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, name: name.trim(), monthly_budget: budget });
    }
  );
});


app.get('/api/expenses', (req, res) => {
  const { category_id, start_date, end_date, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT e.id, e.description, e.amount, e.category_id, e.date, c.name as category_name
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (category_id && category_id !== 'all') {
    query += ' AND e.category_id = ?';
    params.push(parseInt(category_id));
  }

  if (start_date) {
    query += ' AND e.date >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND e.date <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY e.date DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});


app.post('/api/expenses', (req, res) => {
  const { description, amount, category_id, date } = req.body;


  if (!description || description.trim() === '') {
    return res.status(400).json({ error: 'Description is required' });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  if (!category_id) {
    return res.status(400).json({ error: 'Category is required' });
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date is required and must be in YYYY-MM-DD format' });
  }

  db.run(
    'INSERT INTO expenses (description, amount, category_id, date) VALUES (?, ?, ?, ?)',
    [description.trim(), parsedAmount, parseInt(category_id), date],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({
        id: this.lastID,
        description: description.trim(),
        amount: parsedAmount,
        category_id: parseInt(category_id),
        date
      });
    }
  );
});


app.put('/api/expenses/:id', (req, res) => {
  const { id } = req.params;
  const { description, amount, category_id, date } = req.body;

  // Validation
  if (!description || description.trim() === '') {
    return res.status(400).json({ error: 'Description is required' });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  if (!category_id) {
    return res.status(400).json({ error: 'Category is required' });
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Date is required and must be in YYYY-MM-DD format' });
  }

  db.run(
    'UPDATE expenses SET description = ?, amount = ?, category_id = ?, date = ? WHERE id = ?',
    [description.trim(), parsedAmount, parseInt(category_id), date, parseInt(id)],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Expense not found' });
      }
      res.json({ success: true });
    }
  );
});


app.delete('/api/expenses/:id', (req, res) => {
  const { id } = req.params;

  db.run('DELETE FROM expenses WHERE id = ?', [parseInt(id)], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: 'Expense not found' });
    }
    res.json({ success: true });
  });
});


app.get('/api/summary', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);

  db.all(`
    SELECT 
      c.id,
      c.name,
      c.monthly_budget,
      COALESCE(SUM(e.amount), 0) as total_spent,
      CASE 
        WHEN c.monthly_budget IS NOT NULL AND SUM(e.amount) > c.monthly_budget THEN 1
        ELSE 0
      END as is_over_budget
    FROM categories c
    LEFT JOIN expenses e ON c.id = e.category_id
      AND strftime('%Y-%m', e.date) = ?
    GROUP BY c.id, c.name, c.monthly_budget
    ORDER BY c.name
  `, [month], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});


app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.listen(PORT, '0.0.0.0', (err) => {
  if (err) {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is busy. Please stop the existing process or set a different PORT.`);
      process.exit(1);
    }
    console.error('Failed to start server:', err);
    process.exit(1);
  }
  console.log(`Backend server running at http://localhost:${PORT}`);
});
