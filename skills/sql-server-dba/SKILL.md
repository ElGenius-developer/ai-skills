---
name: sql-server-dba
description: 'SQL Server DBA and query optimization assistant. Use when: (1) writing, reviewing, or optimizing T-SQL queries or stored procedures, (2) analyzing execution plans or slow queries, (3) designing indexes or reviewing index strategy, (4) creating or modifying stored procedures, (5) reviewing SQL for security (injection, permissions, data exposure), (6) troubleshooting SQL Server performance (DMVs, waits, blocking), (7) writing idempotent DDL scripts, (8) any .sql file editing or SQL-related code review. Also applies to Laravel/Eloquent queries hitting SQL Server (sqlsrv driver). Supports MySQL/PostgreSQL patterns as secondary — see references/cross-db.md.'
---

# SQL Server DBA

Expert SQL Server administration, T-SQL optimization, stored procedure development, and SQL code review. Primary focus: SQL Server with `sqlsrv` driver. Cross-DB patterns in [references/cross-db.md](references/cross-db.md).

## Decision Tree

```
User request
  |
  +-- Writing/modifying a stored procedure? --> "SP Development" below
  +-- Query is slow or needs optimization?  --> "Query Optimization" below
  +-- Reviewing SQL for security/quality?   --> "Code Review" below
  +-- Index strategy or schema question?    --> "Index & Schema" below
  +-- Performance investigation (DMVs)?     --> references/performance-dmvs.md
  +-- Cross-database (MySQL/PG/Oracle)?     --> references/cross-db.md
```

## SP Development

### Naming & Structure

```sql
-- Prefix: sp_ for system-like, usp_ for user SPs
-- PascalCase: usp_GetOrderDetails, usp_GetDailySalesSummary
CREATE OR ALTER PROCEDURE [dbo].[sp_ProcedureName]
    @TenantID      INT,
    @CustomerID     INT,
    @OptionalParam NVARCHAR(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    -- Body here

END;
```

### Idempotent DDL Pattern

```sql
SET XACT_ABORT ON;
BEGIN TRY
    BEGIN TRANSACTION;

    IF NOT EXISTS (SELECT 1 FROM sys.procedures WHERE name = 'sp_Example')
    BEGIN
        EXEC('CREATE PROCEDURE [dbo].[sp_Example] AS BEGIN RETURN; END');
    END;

    ALTER PROCEDURE [dbo].[sp_Example]
        @TenantID INT
    AS
    BEGIN
        SET NOCOUNT ON;
        -- logic
    END;

    COMMIT;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
```

### Output Formatting

```sql
-- Single-object: use WITHOUT_ARRAY_WRAPPER + JSON_QUERY wrapping
SELECT @json = (
    SELECT v.Order_ID, v.Order_Date,
           (SELECT d.Product_ID, d.Product_Name
            FROM OrderLines d
            WHERE d.Order_ID = v.Order_ID
            FOR JSON PATH) AS lines
    FROM Orders v
    WHERE v.Order_ID = @OrderID
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER
);

-- Multi-row: FOR JSON PATH (returns array)
SELECT Order_ID, Order_Date
FROM Orders
WHERE Tenant_ID = @TenantID
FOR JSON PATH;
```

### Tenant Isolation (CRITICAL)

Every SP querying tenant-scoped tables MUST filter by `Tenant_ID` or `@TenantID` parameter. Never rely solely on RLS — belt-and-suspenders.

## Query Optimization

### Anti-Pattern: Functions in WHERE

```sql
-- BAD: prevents index seek
WHERE YEAR(Created_Date) = 2024

-- GOOD: sargable range
WHERE Created_Date >= '2024-01-01' AND Created_Date < '2025-01-01'
```

### Anti-Pattern: SELECT *

```sql
-- BAD: pulls all columns, breaks covering indexes
SELECT * FROM Orders v JOIN Customers p ON ...

-- GOOD: explicit columns
SELECT v.Order_ID, v.Order_Date, p.Full_Name
FROM Orders v
INNER JOIN Customers p ON v.Customer_ID = p.Customer_ID
```

### Anti-Pattern: Correlated Subqueries

```sql
-- BAD: executes subquery per row
SELECT p.Full_Name,
       (SELECT COUNT(*) FROM Orders v WHERE v.Customer_ID = p.Customer_ID)
FROM Customers p

-- GOOD: window function or JOIN
SELECT p.Full_Name, COUNT(v.Order_ID) AS order_count
FROM Customers p
LEFT JOIN Orders v ON v.Customer_ID = p.Customer_ID
GROUP BY p.Full_Name
```

### Pagination

```sql
-- BAD: OFFSET scales linearly
SELECT * FROM Products ORDER BY ID OFFSET 10000 ROWS FETCH NEXT 20 ROWS ONLY;

-- GOOD: keyset pagination
SELECT TOP 20 * FROM Products WHERE ID > @LastSeenID ORDER BY ID;
```

### Conditional Aggregation (replace N separate COUNT queries)

```sql
SELECT
    COUNT(CASE WHEN Status = 1 THEN 1 END) AS pending,
    COUNT(CASE WHEN Status = 2 THEN 1 END) AS confirmed,
    COUNT(CASE WHEN Status = 3 THEN 1 END) AS completed
FROM Orders
WHERE Tenant_ID = @TenantID;
```

### Batch Operations

```sql
-- BAD: row-by-row INSERT
-- GOOD: batch with table-valued parameter or multi-row VALUES
INSERT INTO OrderLines (Order_ID, Product_ID, Notes)
VALUES
    (@OrderID, 1, N'Note 1'),
    (@OrderID, 2, N'Note 2'),
    (@OrderID, 3, N'Note 3');
```

## Code Review Checklist

### Security

- [ ] All dynamic SQL uses `sp_executesql` with typed parameters — never string concat
- [ ] No `EXEC('SELECT ... ' + @userInput)` patterns
- [ ] Tenant_ID filter on every tenant-scoped query
- [ ] Sensitive columns (national ID, phone, email) not in `SELECT *` or unneeded result sets
- [ ] SP permissions: `EXECUTE AS` or role-based grants, not `dbo` ownership chaining

### Performance

- [ ] No functions on indexed columns in WHERE clauses
- [ ] JOINs use INNER where possible (LEFT only when NULLs needed)
- [ ] No SELECT * in production queries
- [ ] EXISTS preferred over IN for subqueries
- [ ] Large result sets use pagination (OFFSET/FETCH or keyset)
- [ ] Temp tables for complex multi-step queries (not nested subqueries)

### Code Quality

- [ ] SET NOCOUNT ON at SP top
- [ ] SET XACT_ABORT ON for transaction SPs
- [ ] BEGIN TRY / BEGIN CATCH for error handling
- [ ] Consistent UPPER for keywords (SELECT, FROM, WHERE)
- [ ] Column aliases use AS keyword
- [ ] Meaningful parameter names with @ prefix

### Schema Awareness

- [ ] Column names match the project's schema reference exactly (case-sensitive)
- [ ] Data types match schema (NVARCHAR vs VARCHAR, DATETIME2 vs DATETIME)
- [ ] FK relationships used correctly (check schema for actual FK columns)
- [ ] Identity columns not targeted by INSERT unless `SET IDENTITY_INSERT ON`

## Index & Schema

### Covering Index Design

```sql
-- Key columns = WHERE/JOIN, INCLUDE columns = SELECT-only
CREATE NONCLUSTERED INDEX IX_Orders_TenantDate
ON Orders (Tenant_ID, Order_Date)
INCLUDE (Customer_ID, Status, Sales_Rep_ID);
```

### Filtered Index

```sql
-- Index only active records — smaller, faster
CREATE NONCLUSTERED INDEX IX_Orders_Active
ON Orders (Tenant_ID, Order_Date)
WHERE Status IN (1, 2); -- pending, confirmed
```

### Index Rules

1. Lead with highest-selectivity column (usually Tenant_ID, then date/FK)
2. Composite index column order must match query WHERE + ORDER BY
3. INCLUDE columns for covering — avoids key lookups
4. Avoid over-indexing: each index costs INSERT/UPDATE/DELETE performance
5. Review unused indexes via `sys.dm_db_index_usage_stats`

## Review Output Format

When reviewing SQL, report issues as:

```
## [SEVERITY] [CATEGORY]: Brief Description

**Location**: SP/query name, line reference
**Issue**: What is wrong and why
**Fix**:
-- Before (bad)
-- After (good)
**Impact**: Performance gain / security fix / correctness
```

Severity: CRITICAL > HIGH > MEDIUM > LOW

## Resources

- **Performance DMVs & monitoring**: See [references/performance-dmvs.md](references/performance-dmvs.md)
- **Cross-database patterns** (MySQL, PostgreSQL, Oracle): See [references/cross-db.md](references/cross-db.md)
