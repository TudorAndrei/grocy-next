-- Project schema at 644c4a0, before removal of user reference constraints.
-- Frozen input for the existing-database migration check.

DROP TABLE IF EXISTS "api_keys";
CREATE TABLE api_keys (
	id INTEGER NOT NULL,
	api_key VARCHAR(255) NOT NULL,
	user_id INTEGER NOT NULL,
	last_used DATETIME,
	expires DATETIME,
	key_type VARCHAR(64) NOT NULL,
	description TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (api_key),
	FOREIGN KEY(user_id) REFERENCES users (id)
);

DROP TABLE IF EXISTS "chores";
CREATE TABLE chores (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	period_type VARCHAR(32) NOT NULL,
	period_days INTEGER,
	period_interval INTEGER NOT NULL,
	active INTEGER NOT NULL,
	period_config VARCHAR(255),
	track_date_only INTEGER NOT NULL,
	rollover INTEGER NOT NULL,
	assignment_type VARCHAR(64) NOT NULL,
	assignment_config TEXT,
	next_execution_assigned_to_user_id INTEGER,
	start_date DATETIME,
	rescheduled_date DATETIME,
	rescheduled_next_execution_assigned_to_user_id INTEGER,
	consume_product_on_execution INTEGER NOT NULL,
	product_id INTEGER,
	product_amount NUMERIC(15, 6),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name),
	FOREIGN KEY(next_execution_assigned_to_user_id) REFERENCES users (id),
	FOREIGN KEY(rescheduled_next_execution_assigned_to_user_id) REFERENCES users (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);

DROP TABLE IF EXISTS "chores_log";
CREATE TABLE chores_log (
	id INTEGER NOT NULL,
	chore_id INTEGER NOT NULL,
	tracked_time TEXT NOT NULL,
	scheduled_execution_time DATETIME,
	done_by_user_id INTEGER,
	undone INTEGER NOT NULL,
	skipped INTEGER NOT NULL,
	undone_timestamp DATETIME,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(chore_id) REFERENCES chores (id),
	FOREIGN KEY(done_by_user_id) REFERENCES users (id)
);

DROP TABLE IF EXISTS "nutrition_evidence";
CREATE TABLE nutrition_evidence (
	id INTEGER NOT NULL,
	nutrition_id INTEGER NOT NULL,
	revision INTEGER NOT NULL,
	source_type VARCHAR(64) NOT NULL,
	photo_path VARCHAR(1024),
	external_url VARCHAR(1024),
	barcode VARCHAR(255),
	notes TEXT,
	contributor_id INTEGER,
	created_at DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(nutrition_id) REFERENCES product_nutrition (id),
	FOREIGN KEY(contributor_id) REFERENCES users (id)
);

DROP TABLE IF EXISTS "nutrition_proposals";
CREATE TABLE nutrition_proposals (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	expected_revision INTEGER,
	barcode VARCHAR(255),
	payload_json TEXT NOT NULL,
	status VARCHAR(32) NOT NULL,
	conflict_reason TEXT,
	created_by INTEGER,
	approved_by INTEGER,
	expires_at DATETIME,
	created_at DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	decided_at DATETIME,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(created_by) REFERENCES users (id),
	FOREIGN KEY(approved_by) REFERENCES users (id)
);

DROP TABLE IF EXISTS "nutrition_revisions";
CREATE TABLE nutrition_revisions (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	nutrition_id INTEGER NOT NULL,
	revision INTEGER NOT NULL,
	barcode VARCHAR(255),
	basis_quantity NUMERIC(15, 6) NOT NULL,
	basis_unit VARCHAR(32) NOT NULL,
	nutrients_json TEXT NOT NULL,
	origin VARCHAR(32) NOT NULL,
	review_status VARCHAR(32) NOT NULL,
	change_summary TEXT,
	actor_id INTEGER,
	evidence_id INTEGER,
	created_at DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(nutrition_id) REFERENCES product_nutrition (id),
	FOREIGN KEY(actor_id) REFERENCES users (id),
	FOREIGN KEY(evidence_id) REFERENCES nutrition_evidence (id)
);

DROP TABLE IF EXISTS "product_nutrition";
CREATE TABLE product_nutrition (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	barcode VARCHAR(255),
	revision INTEGER NOT NULL,
	is_current INTEGER NOT NULL,
	basis_quantity NUMERIC(15, 6) NOT NULL,
	basis_unit VARCHAR(32) NOT NULL,
	serving_size_quantity NUMERIC(15, 6),
	serving_size_unit VARCHAR(32),
	energy_kj NUMERIC(15, 6),
	energy_kcal NUMERIC(15, 6),
	protein_g NUMERIC(15, 6),
	carbohydrates_g NUMERIC(15, 6),
	sugars_g NUMERIC(15, 6),
	fat_g NUMERIC(15, 6),
	saturated_fat_g NUMERIC(15, 6),
	fiber_g NUMERIC(15, 6),
	salt_g NUMERIC(15, 6),
	source_type VARCHAR(64),
	source_barcode VARCHAR(255),
	source_note TEXT,
	updated_by INTEGER,
	created_at DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	updated_at DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(updated_by) REFERENCES users (id)
);

DROP TABLE IF EXISTS "stock_log";
CREATE TABLE stock_log (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	amount NUMERIC(15, 6) NOT NULL,
	best_before_date DATE,
	purchased_date DATE,
	used_date DATE,
	spoiled INTEGER NOT NULL,
	stock_id VARCHAR(64) NOT NULL,
	transaction_type VARCHAR(64) NOT NULL,
	price NUMERIC(15, 6),
	undone INTEGER NOT NULL,
	undone_timestamp DATETIME,
	opened_date DATETIME,
	location_id INTEGER,
	correlation_id VARCHAR(64),
	transaction_id VARCHAR(64),
	stock_row_id INTEGER,
	shopping_location_id INTEGER,
	user_id INTEGER NOT NULL,
	note TEXT,
	undo_data TEXT,
	recipe_id INTEGER,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(location_id) REFERENCES locations (id),
	FOREIGN KEY(user_id) REFERENCES users (id),
	FOREIGN KEY(recipe_id) REFERENCES recipes (id)
);

DROP TABLE IF EXISTS "tasks";
CREATE TABLE tasks (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	due_date DATETIME,
	done INTEGER NOT NULL,
	done_timestamp DATETIME,
	category_id INTEGER,
	assigned_to_user_id INTEGER,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(category_id) REFERENCES task_categories (id),
	FOREIGN KEY(assigned_to_user_id) REFERENCES users (id)
);

DROP TABLE IF EXISTS "user_permissions";
CREATE TABLE user_permissions (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	permission_id INTEGER NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (user_id, permission_id),
	FOREIGN KEY(user_id) REFERENCES users (id)
);

DROP TABLE IF EXISTS "user_settings";
CREATE TABLE user_settings (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	"key" VARCHAR(255) NOT NULL,
	value TEXT,
	row_updated_timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_user_setting UNIQUE (user_id, "key"),
	FOREIGN KEY(user_id) REFERENCES users (id)
);

DROP TABLE IF EXISTS "users";
CREATE TABLE users (
	id INTEGER NOT NULL,
	username VARCHAR(255) NOT NULL,
	first_name VARCHAR(255),
	last_name VARCHAR(255),
	password VARCHAR(255) NOT NULL,
	picture_file_name VARCHAR(255),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (username)
);
