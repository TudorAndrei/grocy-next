-- Project schema at 453bd92, before the global Grocy allocation counter repair.
-- The equipment table includes an extra unnamed check for the upgrade test.

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
	UNIQUE (api_key)
);

CREATE TABLE batteries (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	used_in VARCHAR(255),
	charge_interval_days INTEGER NOT NULL,
	active INTEGER NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE cache__products_average_price (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	price NUMERIC(15, 6),
	PRIMARY KEY (id),
	UNIQUE (product_id)
);

CREATE TABLE cache__products_last_purchased (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	amount NUMERIC(15, 6),
	best_before_date DATE,
	purchased_date DATE,
	price NUMERIC(15, 6),
	location_id INTEGER,
	shopping_location_id INTEGER,
	PRIMARY KEY (id),
	UNIQUE (product_id)
);

CREATE TABLE equipment (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	instruction_manual_file_name VARCHAR(255),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	CHECK (length(name) > 0)
);

CREATE TABLE locations (
	active INTEGER NOT NULL,
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	is_freezer INTEGER NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE meal_plan_sections (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	sort_number INTEGER NOT NULL,
	time_info VARCHAR(255),
	time_hms VARCHAR(16),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id)
);

CREATE TABLE product_groups (
	active INTEGER NOT NULL,
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE quantity_units (
	active INTEGER NOT NULL,
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	name_plural VARCHAR(255),
	plural_forms TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE shopping_lists (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id)
);

CREATE TABLE shopping_locations (
	active INTEGER NOT NULL,
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE task_categories (
	active INTEGER NOT NULL,
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE user_permissions (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	permission_id INTEGER NOT NULL,
	UNIQUE (user_id, permission_id)
);

CREATE TABLE user_settings (
	id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	"key" VARCHAR(255) NOT NULL,
	value TEXT,
	row_updated_timestamp DATETIME DEFAULT (datetime('now', 'localtime')),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_user_setting UNIQUE (user_id, "key")
);

CREATE TABLE userentities (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	caption VARCHAR(255) NOT NULL,
	description TEXT,
	show_in_sidebar_menu INTEGER NOT NULL,
	icon_css_class VARCHAR(255),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name)
);

CREATE TABLE userfield_values (
	id INTEGER NOT NULL,
	entity VARCHAR(128) NOT NULL,
	object_id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	value TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_userfield_value UNIQUE (entity, object_id, name)
);

CREATE TABLE userfields (
	id INTEGER NOT NULL,
	entity VARCHAR(128) NOT NULL,
	name VARCHAR(255) NOT NULL,
	caption VARCHAR(255) NOT NULL,
	type VARCHAR(64) NOT NULL,
	input_required INTEGER NOT NULL,
	default_value TEXT,
	show_as_column_in_tables INTEGER NOT NULL,
	config TEXT,
	sort_number INTEGER NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (entity, name)
);

CREATE TABLE users (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
	username VARCHAR(255) NOT NULL,
	first_name VARCHAR(255),
	last_name VARCHAR(255),
	password VARCHAR(255) NOT NULL,
	picture_file_name VARCHAR(255),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	UNIQUE (username)
);

CREATE TABLE battery_charge_cycles (
	id INTEGER NOT NULL,
	battery_id INTEGER NOT NULL,
	tracked_time DATETIME NOT NULL,
	undone INTEGER NOT NULL,
	undone_timestamp DATETIME,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(battery_id) REFERENCES batteries (id)
);

CREATE TABLE products (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	location_id INTEGER NOT NULL,
	qu_id_purchase INTEGER NOT NULL,
	qu_id_stock INTEGER NOT NULL,
	qu_factor_purchase_to_stock NUMERIC(15, 6) NOT NULL,
	min_stock_amount NUMERIC(15, 6) NOT NULL,
	default_best_before_days INTEGER NOT NULL,
	product_group_id INTEGER,
	active INTEGER NOT NULL,
	picture_file_name VARCHAR(255),
	parent_product_id INTEGER,
	shopping_location_id INTEGER,
	default_consume_location_id INTEGER,
	tare_weight NUMERIC(15, 6) NOT NULL,
	default_best_before_days_after_open INTEGER NOT NULL,
	enable_tare_weight_handling INTEGER NOT NULL,
	not_check_stock_fulfillment_for_recipes INTEGER NOT NULL,
	treat_opened_as_out_of_stock INTEGER NOT NULL,
	auto_reprint_stock_label INTEGER NOT NULL,
	no_own_stock INTEGER NOT NULL,
	should_not_be_frozen INTEGER NOT NULL,
	move_on_open INTEGER NOT NULL,
	default_best_before_days_after_freezing INTEGER NOT NULL,
	default_best_before_days_after_thawing INTEGER NOT NULL,
	calories INTEGER,
	cumulate_min_stock_amount_of_sub_products INTEGER NOT NULL,
	due_type INTEGER NOT NULL,
	quick_consume_amount NUMERIC(15, 6) NOT NULL,
	quick_open_amount NUMERIC(15, 6) NOT NULL,
	hide_on_stock_overview INTEGER NOT NULL,
	default_stock_label_type INTEGER NOT NULL,
	qu_id_consume INTEGER,
	qu_id_price INTEGER,
	disable_open INTEGER NOT NULL,
	default_purchase_price_type INTEGER NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (name),
	FOREIGN KEY(qu_id_consume) REFERENCES quantity_units (id),
	FOREIGN KEY(qu_id_price) REFERENCES quantity_units (id),
	FOREIGN KEY(qu_id_stock) REFERENCES quantity_units (id),
	FOREIGN KEY(parent_product_id) REFERENCES products (id),
	FOREIGN KEY(default_consume_location_id) REFERENCES locations (id),
	FOREIGN KEY(location_id) REFERENCES locations (id),
	FOREIGN KEY(qu_id_purchase) REFERENCES quantity_units (id),
	FOREIGN KEY(product_group_id) REFERENCES product_groups (id)
);

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
	FOREIGN KEY(category_id) REFERENCES task_categories (id)
);

CREATE TABLE userobjects (
	id INTEGER NOT NULL,
	userentity_id INTEGER NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(userentity_id) REFERENCES userentities (id)
);

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
	FOREIGN KEY(product_id) REFERENCES products (id)
);

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
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE product_barcodes (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	barcode VARCHAR(255) NOT NULL,
	qu_id INTEGER,
	amount NUMERIC(15, 6),
	note TEXT,
	shopping_location_id INTEGER,
	last_price NUMERIC(15, 6),
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_product_barcodes_barcode UNIQUE (barcode),
	FOREIGN KEY(qu_id) REFERENCES quantity_units (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);

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
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE quantity_unit_conversions (
	id INTEGER NOT NULL,
	from_qu_id INTEGER NOT NULL,
	to_qu_id INTEGER NOT NULL,
	factor NUMERIC(18, 8) NOT NULL,
	product_id INTEGER,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(from_qu_id) REFERENCES quantity_units (id),
	FOREIGN KEY(to_qu_id) REFERENCES quantity_units (id),
	CONSTRAINT uq_qu_conversion_scope UNIQUE (from_qu_id, to_qu_id, product_id)
);

CREATE TABLE recipes (
	id INTEGER NOT NULL,
	name VARCHAR(255) NOT NULL,
	description TEXT,
	base_servings NUMERIC(15, 6) NOT NULL,
	desired_servings NUMERIC(15, 6) NOT NULL,
	not_check_stock_fulfillment INTEGER NOT NULL,
	type VARCHAR(32) NOT NULL,
	picture_file_name VARCHAR(255),
	not_check_shoppinglist INTEGER NOT NULL,
	product_id INTEGER,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE shopping_list (
	id INTEGER NOT NULL,
	product_id INTEGER,
	note TEXT,
	amount NUMERIC(15, 6) NOT NULL,
	shopping_list_id INTEGER NOT NULL,
	done INTEGER NOT NULL,
	qu_id INTEGER,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(qu_id) REFERENCES quantity_units (id),
	FOREIGN KEY(shopping_list_id) REFERENCES shopping_lists (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);

CREATE TABLE stock (
	id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	amount NUMERIC(15, 6) NOT NULL,
	best_before_date DATE,
	purchased_date DATE,
	stock_id VARCHAR(64) NOT NULL,
	price NUMERIC(15, 6),
	open INTEGER NOT NULL,
	opened_date DATETIME,
	location_id INTEGER,
	shopping_location_id INTEGER,
	note TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(location_id) REFERENCES locations (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);

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
	FOREIGN KEY(chore_id) REFERENCES chores (id)
);

CREATE INDEX ix_chores_log_performance1 ON chores_log (chore_id, undone, tracked_time);
CREATE TABLE meal_plan (
	id INTEGER NOT NULL,
	day DATE NOT NULL,
	type VARCHAR(32) NOT NULL,
	recipe_id INTEGER,
	recipe_servings NUMERIC(15, 6),
	product_id INTEGER,
	product_amount NUMERIC(15, 6),
	product_qu_id INTEGER,
	note TEXT,
	section_id INTEGER,
	done INTEGER NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(product_qu_id) REFERENCES quantity_units (id),
	FOREIGN KEY(recipe_id) REFERENCES recipes (id),
	FOREIGN KEY(section_id) REFERENCES meal_plan_sections (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);

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
	FOREIGN KEY(nutrition_id) REFERENCES product_nutrition (id)
);

CREATE TABLE recipes_nestings (
	id INTEGER NOT NULL,
	recipe_id INTEGER NOT NULL,
	includes_recipe_id INTEGER NOT NULL,
	servings NUMERIC(15, 6) NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(includes_recipe_id) REFERENCES recipes (id),
	FOREIGN KEY(recipe_id) REFERENCES recipes (id)
);

CREATE TABLE recipes_pos (
	id INTEGER NOT NULL,
	recipe_id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	amount NUMERIC(15, 6) NOT NULL,
	qu_id INTEGER NOT NULL,
	only_check_single_unit_in_stock INTEGER NOT NULL,
	ingredient_group VARCHAR(255),
	note TEXT,
	not_check_stock_fulfillment INTEGER NOT NULL,
	variable_amount VARCHAR(255),
	price_factor NUMERIC(15, 6) NOT NULL,
	round_up INTEGER NOT NULL,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime')) NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(qu_id) REFERENCES quantity_units (id),
	FOREIGN KEY(product_id) REFERENCES products (id),
	FOREIGN KEY(recipe_id) REFERENCES recipes (id)
);

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
	FOREIGN KEY(recipe_id) REFERENCES recipes (id),
	FOREIGN KEY(location_id) REFERENCES locations (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);

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
	FOREIGN KEY(evidence_id) REFERENCES nutrition_evidence (id),
	FOREIGN KEY(nutrition_id) REFERENCES product_nutrition (id),
	FOREIGN KEY(product_id) REFERENCES products (id)
);
