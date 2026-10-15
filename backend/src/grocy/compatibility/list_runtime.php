<?php

// Supply the application connection to the unchanged Grocy read services.
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

class NativeTasksController extends Grocy\Controllers\TasksApiController { use NativeListContext; }
class NativeChoresController extends Grocy\Controllers\ChoresApiController { use NativeListContext; }
class NativeBatteriesController extends Grocy\Controllers\BatteriesApiController { use NativeListContext; }
class NativeStockController extends Grocy\Controllers\StockApiController { use NativeListContext; }
class NativeRecipesController extends Grocy\Controllers\RecipesApiController { use NativeListContext; }

// DatabaseService executes its original raw SELECT calls through this reader.
class NativeRawReader
{
    public function __construct(private NativeDatabase $database)
    {
    }

    public function exec($query)
    {
        $this->database->readQuery($query);
        return 0;
    }

    public function query($query)
    {
        return $this->database->readQuery($query);
    }
}

class NativeReadDatabaseService extends Grocy\Services\DatabaseService
{
    public function __construct(private NativeDatabase $database)
    {
    }

    public function GetDbConnectionRaw()
    {
        return new NativeRawReader($this->database);
    }
}

class NativeUsersListController extends Grocy\Controllers\BaseApiController
{
    use NativeListContext;

    public function GetUsers($request, $response, $args)
    {
        // Python has checked USERS_READ before this call. Keep GetUsers' exception boundary.
        try {
            return $this->FilteredApiResponse($response, $this->getUsersService()->GetUsersAsDto(), $request->getQueryParams());
        } catch (Exception $error) {
            return $this->GenericErrorResponse($response, $error->getMessage());
        }
    }
}

function nativeListRead(array $request, NativeDatabase $database): array
{
    $http = nativeGetRequest($request);
    [$controller, $method, $args] = match ($request['route']) {
        'tasks' => [new NativeTasksController($database), 'Current', []],
        'chores' => [new NativeChoresController($database), 'Current', []],
        'batteries' => [new NativeBatteriesController($database), 'Current', []],
        'users' => [new NativeUsersListController($database), 'GetUsers', []],
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
