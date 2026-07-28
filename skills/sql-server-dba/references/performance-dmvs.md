# SQL Server Performance DMVs & Monitoring

## Table of Contents

1. [Top Slow Queries](#top-slow-queries)
2. [Missing Indexes](#missing-indexes)
3. [Unused Indexes](#unused-indexes)
4. [Index Fragmentation](#index-fragmentation)
5. [Wait Statistics](#wait-statistics)
6. [Blocking & Deadlocks](#blocking--deadlocks)
7. [Execution Plan Analysis](#execution-plan-analysis)
8. [TempDB Pressure](#tempdb-pressure)
9. [Memory & Buffer](#memory--buffer)

## Top Slow Queries

```sql
-- Top 20 queries by average elapsed time
SELECT TOP 20
    qs.total_elapsed_time / qs.execution_count AS avg_elapsed_us,
    qs.execution_count,
    qs.total_logical_reads / qs.execution_count AS avg_logical_reads,
    qs.total_worker_time / qs.execution_count AS avg_cpu_us,
    SUBSTRING(qt.text,
        (qs.statement_start_offset / 2) + 1,
        ((CASE qs.statement_end_offset
            WHEN -1 THEN DATALENGTH(qt.text)
            ELSE qs.statement_end_offset
        END - qs.statement_start_offset) / 2) + 1) AS query_text,
    qp.query_plan
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
ORDER BY avg_elapsed_us DESC;
```

```sql
-- Top 10 queries by total logical reads (I/O pressure)
SELECT TOP 10
    qs.total_logical_reads,
    qs.execution_count,
    qs.total_logical_reads / qs.execution_count AS avg_reads,
    SUBSTRING(qt.text, (qs.statement_start_offset/2)+1,
        ((CASE qs.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text)
         ELSE qs.statement_end_offset END - qs.statement_start_offset)/2)+1) AS query_text
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_sql_text(qs.sql_handle) qt
ORDER BY qs.total_logical_reads DESC;
```

## Missing Indexes

```sql
-- Indexes SQL Server recommends based on query patterns
SELECT
    CONVERT(DECIMAL(18,2), migs.avg_user_impact) AS avg_improvement_pct,
    migs.user_seeks + migs.user_scans AS total_uses,
    mid.statement AS table_name,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    'CREATE NONCLUSTERED INDEX [IX_' +
        REPLACE(REPLACE(REPLACE(mid.statement, '[', ''), ']', ''), '.', '_') +
        '] ON ' + mid.statement +
        ' (' + ISNULL(mid.equality_columns, '') +
        CASE WHEN mid.inequality_columns IS NOT NULL
             THEN CASE WHEN mid.equality_columns IS NOT NULL THEN ', ' ELSE '' END +
                  mid.inequality_columns
             ELSE '' END +
        ')' +
        CASE WHEN mid.included_columns IS NOT NULL
             THEN ' INCLUDE (' + mid.included_columns + ')'
             ELSE '' END AS create_statement
FROM sys.dm_db_missing_index_group_stats migs
INNER JOIN sys.dm_db_missing_index_groups mig
    ON migs.group_handle = mig.index_group_handle
INNER JOIN sys.dm_db_missing_index_details mid
    ON mig.index_handle = mid.index_handle
WHERE mid.database_id = DB_ID()
ORDER BY avg_improvement_pct * (migs.user_seeks + migs.user_scans) DESC;
```

## Unused Indexes

```sql
-- Indexes with zero seeks/scans but nonzero updates (write cost, no read benefit)
SELECT
    OBJECT_NAME(i.object_id) AS table_name,
    i.name AS index_name,
    i.type_desc,
    ius.user_seeks, ius.user_scans, ius.user_lookups,
    ius.user_updates,
    'DROP INDEX ' + QUOTENAME(i.name) + ' ON ' +
        QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(OBJECT_NAME(i.object_id)) AS drop_statement
FROM sys.indexes i
INNER JOIN sys.objects o ON i.object_id = o.object_id
LEFT JOIN sys.dm_db_index_usage_stats ius
    ON i.object_id = ius.object_id AND i.index_id = ius.index_id AND ius.database_id = DB_ID()
WHERE o.type = 'U'
    AND i.type_desc = 'NONCLUSTERED'
    AND i.is_primary_key = 0
    AND i.is_unique_constraint = 0
    AND ISNULL(ius.user_seeks, 0) = 0
    AND ISNULL(ius.user_scans, 0) = 0
    AND ISNULL(ius.user_updates, 0) > 0
ORDER BY ius.user_updates DESC;
```

## Index Fragmentation

```sql
-- Check fragmentation for tables > 1000 pages
SELECT
    OBJECT_NAME(ips.object_id) AS table_name,
    i.name AS index_name,
    ips.avg_fragmentation_in_percent,
    ips.page_count,
    CASE
        WHEN ips.avg_fragmentation_in_percent > 30 THEN 'REBUILD'
        WHEN ips.avg_fragmentation_in_percent > 10 THEN 'REORGANIZE'
        ELSE 'OK'
    END AS action_needed
FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED') ips
INNER JOIN sys.indexes i ON ips.object_id = i.object_id AND ips.index_id = i.index_id
WHERE ips.page_count > 1000
    AND ips.avg_fragmentation_in_percent > 10
ORDER BY ips.avg_fragmentation_in_percent DESC;
```

## Wait Statistics

```sql
-- Top 10 wait types (excludes idle waits)
SELECT TOP 10
    wait_type,
    wait_time_ms / 1000.0 AS wait_time_sec,
    signal_wait_time_ms / 1000.0 AS signal_wait_sec,
    waiting_tasks_count,
    wait_time_ms * 100.0 / SUM(wait_time_ms) OVER() AS pct
FROM sys.dm_os_wait_stats
WHERE wait_type NOT IN (
    'SLEEP_TASK', 'BROKER_TASK_STOP', 'BROKER_EVENTHANDLER',
    'CLR_AUTO_EVENT', 'CLR_MANUAL_EVENT', 'LAZYWRITER_SLEEP',
    'SQLTRACE_BUFFER_FLUSH', 'WAITFOR', 'XE_TIMER_EVENT',
    'XE_DISPATCHER_WAIT', 'FT_IFTS_SCHEDULER_IDLE_WAIT',
    'DISPATCHER_QUEUE_SEMAPHORE', 'CHECKPOINT_QUEUE',
    'REQUEST_FOR_DEADLOCK_SEARCH', 'LOGMGR_QUEUE',
    'ONDEMAND_TASK_QUEUE', 'BROKER_TO_FLUSH', 'DIRTY_PAGE_POLL',
    'HADR_FILESTREAM_IOMGR_IOCOMPLETION', 'SP_SERVER_DIAGNOSTICS_SLEEP'
)
ORDER BY wait_time_ms DESC;
```

## Blocking & Deadlocks

```sql
-- Currently blocked sessions
SELECT
    r.session_id AS blocked_session,
    r.blocking_session_id,
    r.wait_type,
    r.wait_time / 1000.0 AS wait_sec,
    SUBSTRING(qt.text, (r.statement_start_offset/2)+1,
        ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(qt.text)
         ELSE r.statement_end_offset END - r.statement_start_offset)/2)+1) AS blocked_query,
    bt.text AS blocking_query
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) qt
LEFT JOIN sys.dm_exec_requests br ON r.blocking_session_id = br.session_id
OUTER APPLY sys.dm_exec_sql_text(br.sql_handle) bt
WHERE r.blocking_session_id > 0;
```

## Execution Plan Analysis

### Reading Execution Plans — Key Operators

| Operator | Meaning | Action |
|----------|---------|--------|
| Table Scan | No usable index | Add appropriate index |
| Index Scan | Reading all index rows | Add WHERE filter or make index covering |
| Key Lookup | Index found row but needs extra columns | Add INCLUDE columns to index |
| Sort (warning) | Sort spilling to TempDB | Add ORDER BY columns to index |
| Hash Match | Large unsorted JOIN | Consider index to enable merge/nested loop |
| Parallelism (CXPACKET) | Skewed parallelism | Check data distribution |

### Force Execution Plan Check

```sql
-- Show estimated plan without executing
SET SHOWPLAN_XML ON;
GO
-- your query here
GO
SET SHOWPLAN_XML OFF;

-- Show actual plan with execution
SET STATISTICS XML ON;
-- your query here
SET STATISTICS XML OFF;
```

## TempDB Pressure

```sql
-- Sessions using most TempDB space
SELECT TOP 10
    tsu.session_id,
    tsu.internal_objects_alloc_page_count + tsu.user_objects_alloc_page_count AS total_pages,
    (tsu.internal_objects_alloc_page_count + tsu.user_objects_alloc_page_count) * 8 / 1024 AS total_mb,
    t.text AS query_text
FROM sys.dm_db_task_space_usage tsu
INNER JOIN sys.dm_exec_requests r ON tsu.session_id = r.session_id
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
ORDER BY total_pages DESC;
```

## Memory & Buffer

```sql
-- Top tables by buffer pool usage (cached pages)
SELECT TOP 20
    OBJECT_NAME(p.object_id) AS table_name,
    COUNT(*) AS cached_pages,
    COUNT(*) * 8 / 1024 AS cached_mb
FROM sys.dm_os_buffer_descriptors bd
INNER JOIN sys.allocation_units au ON bd.allocation_unit_id = au.allocation_unit_id
INNER JOIN sys.partitions p ON au.container_id = p.hobt_id
WHERE bd.database_id = DB_ID()
GROUP BY p.object_id
ORDER BY cached_pages DESC;
```

## Optimization Methodology

1. **Identify**: Run top-slow-queries DMV to find candidates
2. **Analyze**: Get execution plan, check for scans/lookups/sorts
3. **Check missing indexes**: Cross-reference with DMV suggestions
4. **Optimize**: Add index or rewrite query
5. **Validate**: Compare before/after execution stats
6. **Monitor**: Re-check after deployment under real load
