<?php

// Supply the application connection to the unchanged Grocy services.
trait NativeListContext
{
    public function __construct(private NativeDatabase $database)
    {
    }

    protected function getDatabase()
    {
        return $this->database;
    }

    protected function getDatabaseService()
    {
        return new NativeReadDatabaseService($this->database);
    }

    protected function getUsersService()
    {
        return new NativeUsersService($this->database);
    }

    protected function getApiKeyService()
    {
        return new NativeApiKeyService($this->database);
    }

    protected function getFilesService()
    {
        return new NativeFilesService(NATIVE_FILES_ROOT);
    }

    protected function getApplicationService()
    {
        return new NativeApplicationService($this->database);
    }

    protected function getPrintService()
    {
        return new NativePrintService($this->database);
    }

    protected function getCalendarService()
    {
        return new NativeCalendarService($this->database);
    }

    protected function getTasksService()
    {
        return new NativeTasksService($this->database);
    }

    protected function getChoresService()
    {
        return new NativeChoresService($this->database);
    }

    protected function getBatteriesService()
    {
        return new NativeBatteriesService($this->database);
    }

    protected function getStockService()
    {
        return new NativeStockService($this->database);
    }

    protected function getRecipesService()
    {
        return new NativeRecipesService($this->database);
    }
}

class NativeUsersService extends Grocy\Services\UsersService { use NativeListContext; }
class NativeTasksService extends Grocy\Services\TasksService { use NativeListContext; }
class NativeChoresService extends Grocy\Services\ChoresService { use NativeListContext; }
class NativeBatteriesService extends Grocy\Services\BatteriesService { use NativeListContext; }
class NativeStockService extends Grocy\Services\StockService { use NativeListContext; }
class NativeRecipesService extends Grocy\Services\RecipesService { use NativeListContext; }
class NativeApplicationService extends Grocy\Services\ApplicationService { use NativeListContext; }
class NativePrintService extends Grocy\Services\PrintService { use NativeListContext; }
class NativeApiKeyService extends Grocy\Services\ApiKeyService { use NativeListContext; }

class NativeCalendarService extends Grocy\Services\CalendarService
{
    use NativeListContext { __construct as private setDatabase; }

    public function __construct(NativeDatabase $database)
    {
        $this->setDatabase($database);
        parent::__construct();
    }
}

class NativeTasksController extends Grocy\Controllers\TasksApiController { use NativeListContext; }
class NativeChoresController extends Grocy\Controllers\ChoresApiController { use NativeListContext; }
class NativeBatteriesController extends Grocy\Controllers\BatteriesApiController { use NativeListContext; }
class NativeStockController extends Grocy\Controllers\StockApiController { use NativeListContext; }
class NativeRecipesController extends Grocy\Controllers\RecipesApiController { use NativeListContext; }
class NativeUsersController extends Grocy\Controllers\UsersApiController { use NativeListContext; }

class NativeSystemController extends Grocy\Controllers\SystemApiController { use NativeListContext; }

class NativeLocaleMiddleware extends Grocy\Middleware\LocaleMiddleware
{
    public function __construct() {}

    public function selectLocale($request)
    {
        return $this->getLocale($request);
    }
}

class NativePrintController extends Grocy\Controllers\PrintApiController { use NativeListContext; }

trait NativeUrlContext
{
    use NativeListContext { __construct as private setDatabase; }

    public function __construct(NativeDatabase $database)
    {
        $this->setDatabase($database);
        $this->AppContainer = new class {
            public function get(string $name)
            {
                return match ($name) {
                    'UrlManager' => new Grocy\Helpers\UrlManager(GROCY_BASE_URL),
                    default => throw new RuntimeException('Unknown native calendar dependency'),
                };
            }
        };
    }
}

class NativeCalendarController extends Grocy\Controllers\CalendarApiController { use NativeUrlContext; }
class NativeOpenApiController extends Grocy\Controllers\OpenApiController { use NativeUrlContext; }

// DatabaseService retains its raw SQL and explicit transaction calls.
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

function nativeListRead(array $request, NativeDatabase $database): array
{
    $http = nativeGetRequest($request);
    [$controller, $method, $args] = match ($request['route']) {
        'tasks' => [new NativeTasksController($database), 'Current', []],
        'chores' => [new NativeChoresController($database), 'Current', []],
        'batteries' => [new NativeBatteriesController($database), 'Current', []],
        'recipes' => [new NativeRecipesController($database), 'GetRecipeFulfillment', []],
        'stock' => [new NativeStockController($database), 'CurrentStock', []],
        'volatile' => [new NativeStockController($database), 'CurrentVolatileStock', []],
        'product_entries' => [new NativeStockController($database), 'ProductStockEntries', ['productId' => $request['object_id']]],
        'product_locations' => [new NativeStockController($database), 'ProductStockLocations', ['productId' => $request['object_id']]],
        'location_entries' => [new NativeStockController($database), 'LocationStockEntries', ['locationId' => $request['object_id']]],
        default => throw new RuntimeException('Unknown native list route'),
    };
    return nativeEncodedResponse($controller->$method($http, nativeApiResponse(), $args));
}
