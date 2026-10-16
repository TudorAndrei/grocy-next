<?php

// Native permission checks use the same application connection as each action.
function nativeAction(array $request, NativeDatabase $database): array
{
    global $GROCY_DEFAULT_USER_SETTINGS;
    $GROCY_DEFAULT_USER_SETTINGS = json_decode(file_get_contents(__DIR__ . '/grocy_4_5_0_client_defaults.json'), true, 512, JSON_THROW_ON_ERROR)['user_settings'];
    define('GROCY_DEFAULT_PERMISSIONS', $request['default_permissions']);
    foreach ($request['configuration'] as $name => $value) {
        define($name, $value);
    }
    (new ReflectionProperty(Grocy\Services\DatabaseService::class, 'DbConnection'))->setValue(null, $database);
    $http = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest(
        $request['method'], 'http://localhost/api/?' . base64_decode($request['query_string'], true)
    );
    $http = $http->withBody((new Slim\Psr7\Factory\StreamFactory())->createStream(
        base64_decode($request['json'], true)
    ));
    if ($request['content_type'] !== null) {
        $http = $http->withHeader('Content-Type', $request['content_type']);
    }
    $http = new Slim\Http\ServerRequest($http);
    $response = nativeApiResponse();
    try {
        [$controller, $method, $args] = match ($request['route']) {
            'task_complete' => [new NativeTasksController($database), 'MarkTaskAsCompleted', ['taskId' => $request['object_id']]],
            'task_undo' => [new NativeTasksController($database), 'UndoTask', ['taskId' => $request['object_id']]],
            'battery_charge' => [new NativeBatteriesController($database), 'TrackChargeCycle', ['batteryId' => $request['object_id']]],
            'battery_undo' => [new NativeBatteriesController($database), 'UndoChargeCycle', ['chargeCycleId' => $request['object_id']]],
            'battery_details' => [new NativeBatteriesController($database), 'BatteryDetails', ['batteryId' => $request['object_id']]],
            'user_current' => [new NativeUsersController($database), 'CurrentUser', []],
            'users' => [new NativeUsersController($database), 'GetUsers', []],
            'user_create' => [new NativeUsersController($database), 'CreateUser', []],
            'user_edit' => [new NativeUsersController($database), 'EditUser', ['userId' => $request['object_id']]],
            'user_delete' => [new NativeUsersController($database), 'DeleteUser', ['userId' => $request['object_id']]],
            'permissions_get' => [new NativeUsersController($database), 'ListPermissions', ['userId' => $request['object_id']]],
            'permission_add' => [new NativeUsersController($database), 'AddPermission', ['userId' => $request['object_id']]],
            'permissions_set' => [new NativeUsersController($database), 'SetPermissions', ['userId' => $request['object_id']]],
            'settings' => [new NativeUsersController($database), 'GetUserSettings', []],
            'setting_get' => [new NativeUsersController($database), 'GetUserSetting', ['settingKey' => $request['object_id']]],
            'setting_set' => [new NativeUsersController($database), 'SetUserSetting', ['settingKey' => $request['object_id']]],
            'setting_delete' => [new NativeUsersController($database), 'DeleteUserSetting', ['settingKey' => $request['object_id']]],
            'chore_details' => [new NativeChoresController($database), 'ChoreDetails', ['choreId' => $request['object_id']]],
            'chore_execute' => [new NativeChoresController($database), 'TrackChoreExecution', ['choreId' => $request['object_id']]],
            'chore_undo' => [new NativeChoresController($database), 'UndoChoreExecution', ['executionId' => $request['object_id']]],
            'chore_assign' => [new NativeChoresController($database), 'CalculateNextExecutionAssignments', []],
            'chore_merge' => [new NativeChoresController($database), 'MergeChores', ['choreIdToKeep' => $request['object_id'], 'choreIdToRemove' => $request['arguments']['remove_id']]],
            'recipe_fulfillment' => [new NativeRecipesController($database), 'GetRecipeFulfillment', ['recipeId' => $request['object_id']]],
            'recipe_consume' => [new NativeRecipesController($database), 'ConsumeRecipe', ['recipeId' => $request['object_id']]],
            'recipe_copy' => [new NativeRecipesController($database), 'CopyRecipe', ['recipeId' => $request['object_id']]],
            'recipe_shopping' => [new NativeRecipesController($database), 'AddNotFulfilledProductsToShoppingList', ['recipeId' => $request['object_id']]],
            'shopping_missing' => [new NativeStockController($database), 'AddMissingProductsToShoppingList', []],
            'shopping_overdue' => [new NativeStockController($database), 'AddOverdueProductsToShoppingList', []],
            'shopping_expired' => [new NativeStockController($database), 'AddExpiredProductsToShoppingList', []],
            'shopping_add' => [new NativeStockController($database), 'AddProductToShoppingList', []],
            'shopping_remove' => [new NativeStockController($database), 'RemoveProductFromShoppingList', []],
            'shopping_clear' => [new NativeStockController($database), 'ClearShoppingList', []],
            'stock_entry' => [new NativeStockController($database), 'StockEntry', ['entryId' => $request['object_id']]],
            'stock_edit' => [new NativeStockController($database), 'EditStockEntry', ['entryId' => $request['object_id']]],
            'stock_entry_label' => [new NativeStockController($database), 'StockEntryPrintLabel', ['entryId' => $request['object_id']]],
            'stock_product' => [new NativeStockController($database), 'ProductDetails', ['productId' => $request['object_id']]],
            'stock_prices' => [new NativeStockController($database), 'ProductPriceHistory', ['productId' => $request['object_id']]],
            'stock_product_label' => [new NativeStockController($database), 'ProductPrintLabel', ['productId' => $request['object_id']]],
            'stock_booking' => [new NativeStockController($database), 'StockBooking', ['bookingId' => $request['object_id']]],
            'stock_undo' => [new NativeStockController($database), 'UndoBooking', ['bookingId' => $request['object_id']]],
            'stock_transaction' => [new NativeStockController($database), 'StockTransactions', ['transactionId' => $request['object_id']]],
            'stock_undo_transaction' => [new NativeStockController($database), 'UndoTransaction', ['transactionId' => $request['object_id']]],
            'stock_add' => [new NativeStockController($database), 'AddProduct', ['productId' => $request['object_id']]],
            'stock_add_barcode' => [new NativeStockController($database), 'AddProductByBarcode', ['barcode' => $request['object_id']]],
            'stock_consume' => [new NativeStockController($database), 'ConsumeProduct', ['productId' => $request['object_id']]],
            'stock_consume_barcode' => [new NativeStockController($database), 'ConsumeProductByBarcode', ['barcode' => $request['object_id']]],
            'stock_open' => [new NativeStockController($database), 'OpenProduct', ['productId' => $request['object_id']]],
            'stock_open_barcode' => [new NativeStockController($database), 'OpenProductByBarcode', ['barcode' => $request['object_id']]],
            'stock_transfer' => [new NativeStockController($database), 'TransferProduct', ['productId' => $request['object_id']]],
            'stock_transfer_barcode' => [new NativeStockController($database), 'TransferProductByBarcode', ['barcode' => $request['object_id']]],
            'stock_inventory' => [new NativeStockController($database), 'InventoryProduct', ['productId' => $request['object_id']]],
            'stock_inventory_barcode' => [new NativeStockController($database), 'InventoryProductByBarcode', ['barcode' => $request['object_id']]],
            'stock_external_barcode' => [new NativeStockController($database), 'ExternalBarcodeLookup', ['barcode' => $request['object_id']]],
            'stock_barcode' => [new NativeStockController($database), 'ProductDetailsByBarcode', ['barcode' => $request['object_id']]],
            'stock_merge' => [new NativeStockController($database), 'MergeProducts', ['productIdToKeep' => $request['object_id'], 'productIdToRemove' => $request['arguments']['remove_id']]],
            'chore_label' => [new NativeChoresController($database), 'ChorePrintLabel', ['choreId' => $request['object_id']]],
            'battery_label' => [new NativeBatteriesController($database), 'BatteryPrintLabel', ['batteryId' => $request['object_id']]],
            'recipe_label' => [new NativeRecipesController($database), 'RecipePrintLabel', ['recipeId' => $request['object_id']]],
            'shopping_thermal' => [new NativePrintController($database), 'PrintShoppingListThermal', []],
            'calendar_ical' => [new NativeCalendarController($database), 'Ical', []],
            'calendar_sharing' => [new NativeCalendarController($database), 'IcalSharingLink', []],
            default => throw new RuntimeException('Unknown native action route'),
        };
        $response = $controller->$method($http, $response, $args);
    } catch (Throwable $error) {
        $status = $error instanceof Slim\Exception\HttpException ? $error->getCode() : 500;
        $response = $response->withStatus($status)->withJson([
            'error_message' => $error->getMessage(),
            'error_details' => nativeErrorDetails($error),
        ]);
    } finally {
        (new ReflectionProperty(Grocy\Services\DatabaseService::class, 'DbConnection'))->setValue(null, null);
    }
    return nativeEncodedResponse($response);
}
