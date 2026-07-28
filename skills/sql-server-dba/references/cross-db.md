# Cross-Database SQL Patterns

Portable optimization patterns for MySQL, PostgreSQL, and Oracle. Use when the project targets a non-SQL-Server database or needs cross-DB compatibility.

## Table of Contents

1. [Syntax Differences Quick Reference](#syntax-differences)
2. [MySQL Patterns](#mysql)
3. [PostgreSQL Patterns](#postgresql)
4. [Oracle Patterns](#oracle)
5. [Universal Anti-Patterns](#universal-anti-patterns)

## Syntax Differences

| Feature | SQL Server | MySQL | PostgreSQL | Oracle |
|---------|-----------|-------|------------|--------|
| Identity | `IDENTITY(1,1)` | `AUTO_INCREMENT` | `SERIAL` / `GENERATED ALWAYS` | `SEQUENCE` |
| Top N | `TOP N` | `LIMIT N` | `LIMIT N` | `FETCH FIRST N ROWS ONLY` |
| String concat | `+` or `CONCAT()` | `CONCAT()` | `\|\|` | `\|\|` |
| Current time | `GETUTCDATE()` | `UTC_TIMESTAMP()` | `NOW() AT TIME ZONE 'UTC'` | `SYSTIMESTAMP` |
| Upsert | `MERGE` | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT ... DO UPDATE` | `MERGE` |
| JSON path | `JSON_VALUE()` | `->`, `->>` | `->`, `->>`, `jsonb` | `JSON_VALUE()` |
| Temp tables | `#temp` | `CREATE TEMPORARY TABLE` | `CREATE TEMP TABLE` | `GTT` |
| CTE | `WITH` | `WITH` (8.0+) | `WITH` | `WITH` |
| Window funcs | Full support | 8.0+ | Full support | Full support |

## MySQL

### Engine Selection
```sql
CREATE TABLE orders (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    customer_id BIGINT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_customer (customer_id),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
) ENGINE=InnoDB;
```

### Covering Index (no INCLUDE syntax)
```sql
CREATE INDEX idx_orders_covering
ON orders(customer_id, created_at, total, status);
```

### Slow Query Discovery
```sql
SELECT query_time, lock_time, rows_sent, rows_examined, sql_text
FROM mysql.slow_log ORDER BY query_time DESC LIMIT 20;
```

## PostgreSQL

### JSONB + GIN Index
```sql
CREATE TABLE events (
    id SERIAL PRIMARY KEY,
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_events_data ON events USING gin(data);
SELECT * FROM events WHERE data @> '{"type": "login"}';
```

### Partial Index
```sql
CREATE INDEX idx_orders_active ON orders(created_at)
WHERE status IN ('pending', 'processing');
```

### Performance Discovery
```sql
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 20;
```

## Oracle

### Sequence-Based Identity
```sql
CREATE SEQUENCE order_id_seq START WITH 1 INCREMENT BY 1;
CREATE TABLE orders (
    id NUMBER DEFAULT order_id_seq.NEXTVAL PRIMARY KEY,
    customer_id NUMBER NOT NULL,
    total NUMBER(10,2) NOT NULL
);
```

## Universal Anti-Patterns

### N+1 Queries
```sql
-- BAD: loop of individual queries
-- GOOD: single JOIN or batch IN()
SELECT u.*, o.* FROM users u LEFT JOIN orders o ON u.id = o.user_id;
```

### DISTINCT Masking Bad JOINs
```sql
-- BAD: SELECT DISTINCT hiding duplicates from wrong JOIN
-- GOOD: proper JOIN + GROUP BY
```

### Implicit Type Conversion
```sql
-- BAD: WHERE user_id = '42' (user_id is INT) — prevents index
-- GOOD: WHERE user_id = 42
```

### OR vs UNION ALL
```sql
-- If OR prevents index usage, split into UNION ALL
SELECT * FROM products WHERE category = 'A' AND price < 100
UNION ALL
SELECT * FROM products WHERE category = 'B' AND price < 50;
```
