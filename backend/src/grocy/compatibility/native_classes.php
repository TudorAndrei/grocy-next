<?php

// Load native parents when the request first uses their application service.
spl_autoload_register(function (string $class): void {
    if (defined('NATIVE_HTTP_CONTEXT') && $class === 'Grocy\\Services\\DatabaseService') {
        require __DIR__ . '/../_vendor/grocy-core/services/DatabaseService.php';
        if (defined('GROCY_MODE') && isset($GLOBALS['NativeRequestDatabase'])) nativeBindHttpDatabase();
        return;
    }
    switch ($class) {
        case 'NativeUserfieldsService':
            class NativeUserfieldsService extends Grocy\Services\UserfieldsService
            {
                public function __construct(private NativeDatabase $database)
                {
                }

                protected function getDatabase()
                {
                    return $this->database;
                }
            }
            return;
        case 'NativeGenericController':
            class NativeGenericController extends Grocy\Controllers\GenericEntityApiController
            {
                private NativeUserfieldsService $fields;

                public function __construct(private NativeDatabase $database)
                {
                    $this->fields = new NativeUserfieldsService($database);
                }

                protected function getDatabase()
                {
                    return $this->database;
                }

                protected function getUserfieldsService()
                {
                    return $this->fields;
                }

                public function parseBody($request)
                {
                    return $this->GetParsedAndFilteredRequestBody($request);
                }
            }
            return;
        case 'NativeUsersService':
            class NativeUsersService extends Grocy\Services\UsersService { use NativeListContext; }
            return;
        case 'NativeTasksService':
            class NativeTasksService extends Grocy\Services\TasksService { use NativeListContext; }
            return;
        case 'NativeChoresService':
            class NativeChoresService extends Grocy\Services\ChoresService { use NativeListContext; }
            return;
        case 'NativeBatteriesService':
            class NativeBatteriesService extends Grocy\Services\BatteriesService { use NativeListContext; }
            return;
        case 'NativeStockService':
            class NativeStockService extends Grocy\Services\StockService { use NativeListContext; }
            return;
        case 'NativeRecipesService':
            class NativeRecipesService extends Grocy\Services\RecipesService { use NativeListContext; }
            return;
        case 'NativeApplicationService':
            class NativeApplicationService extends Grocy\Services\ApplicationService { use NativeListContext; }
            return;
        case 'NativePrintService':
            class NativePrintService extends Grocy\Services\PrintService { use NativeListContext; }
            return;
        case 'NativeApiKeyService':
            class NativeApiKeyService extends Grocy\Services\ApiKeyService { use NativeListContext; }
            return;
        case 'NativeCalendarService':
            class NativeCalendarService extends Grocy\Services\CalendarService
            {
                use NativeListContext { __construct as private setDatabase; }

                public function __construct(NativeDatabase $database)
                {
                    $this->setDatabase($database);
                    parent::__construct();
                }
            }
            return;
        case 'NativeTasksController':
            class NativeTasksController extends Grocy\Controllers\TasksApiController { use NativeListContext; }
            return;
        case 'NativeChoresController':
            class NativeChoresController extends Grocy\Controllers\ChoresApiController { use NativeListContext; }
            return;
        case 'NativeBatteriesController':
            class NativeBatteriesController extends Grocy\Controllers\BatteriesApiController { use NativeListContext; }
            return;
        case 'NativeStockController':
            class NativeStockController extends Grocy\Controllers\StockApiController { use NativeListContext; }
            return;
        case 'NativeRecipesController':
            class NativeRecipesController extends Grocy\Controllers\RecipesApiController { use NativeListContext; }
            return;
        case 'NativeUsersController':
            class NativeUsersController extends Grocy\Controllers\UsersApiController { use NativeListContext; }
            return;
        case 'NativeSystemController':
            class NativeSystemController extends Grocy\Controllers\SystemApiController { use NativeListContext; }
            return;
        case 'NativeFileRoutesController':
            class NativeFileRoutesController extends Grocy\Controllers\FilesApiController { use NativeListContext; }
            return;
        case 'NativeLocaleMiddleware':
            class NativeLocaleMiddleware extends Grocy\Middleware\LocaleMiddleware
            {
                public function __construct() {}

                public function selectLocale($request)
                {
                    return $this->getLocale($request);
                }
            }
            return;
        case 'NativePrintController':
            class NativePrintController extends Grocy\Controllers\PrintApiController { use NativeListContext; }
            return;
        case 'NativeCalendarController':
            class NativeCalendarController extends Grocy\Controllers\CalendarApiController { use NativeUrlContext; }
            return;
        case 'NativeOpenApiController':
            class NativeOpenApiController extends Grocy\Controllers\OpenApiController { use NativeUrlContext; }
            return;
        case 'NativeRawReader':
            class NativeRawReader
            {
                public function __construct(private NativeDatabase $database)
                {
                }

                public function exec($query)
                {
                    return $this->database->executeQuery($query)->rowCount();
                }

                public function query($query)
                {
                    return $this->database->readQuery($query);
                }

                public function prepare($query)
                {
                    return $this->database->prepareExecution($query);
                }

                public function beginTransaction()
                {
                    return $this->database->transaction('begin');
                }

                public function commit()
                {
                    return $this->database->transaction('commit');
                }

                public function rollBack()
                {
                    return $this->database->transaction('rollback');
                }
            }
            return;
        case 'NativeReadDatabaseService':
            class NativeReadDatabaseService extends Grocy\Services\DatabaseService
            {
                public function __construct(private NativeDatabase $database)
                {
                }

                public function GetDbChangedTime()
                {
                    return date('Y-m-d H:i:s', NATIVE_DATABASE_FILE === null ? time() : filemtime(NATIVE_DATABASE_FILE));
                }

                public function SetDbChangedTime($dateTime)
                {
                    if (NATIVE_DATABASE_FILE !== null) {
                        touch(NATIVE_DATABASE_FILE, strtotime($dateTime));
                    }
                }

                public function GetDbConnectionRaw()
                {
                    return new NativeRawReader($this->database);
                }
            }
            return;
        case 'NativeFilesService':
            class NativeFilesService extends Grocy\Services\FilesService
            {
                public function __construct(string $root)
                {
                    if (!is_dir($root)) {
                        mkdir($root, 0777, true);
                    }
                    // The application config selects the storage root; all file logic stays native.
                    (new ReflectionProperty(Grocy\Services\FilesService::class, 'StoragePath'))->setValue($this, $root);
                }
            }
            return;
    }
}, true, true);
