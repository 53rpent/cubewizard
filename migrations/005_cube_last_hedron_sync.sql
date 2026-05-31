-- Track last manual Hedron sync for per-cube cooldown (cron auto-sync unaffected).
ALTER TABLE cubes ADD COLUMN last_hedron_sync TIMESTAMP;
