-- Issue #190: record why a run ended when a stop condition or crash terminates it.
ALTER TABLE runs ADD COLUMN stopped_reason TEXT;
