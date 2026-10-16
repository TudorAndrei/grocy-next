<?php

// Supply the application connection to the unchanged Grocy services.
trait NativeListContext
{
    public function __construct(private NativeDatabase $database)
    {
    }

    protected function getDatabase()
    {
        if (defined('NATIVE_HTTP_CONTEXT')) return $this->getDatabaseService()->GetDbConnection();
        return $this->database;
    }

    protected function getDatabaseService()
    {
        if (defined('NATIVE_HTTP_CONTEXT')) return Grocy\Services\DatabaseService::getInstance();
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

// DatabaseService retains its raw SQL and explicit transaction calls.

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
