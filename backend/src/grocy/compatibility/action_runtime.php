<?php

// Native permission checks use the same application connection as each action.
function nativeAction(array $request, NativeDatabase $database): array
{
    (new ReflectionProperty(Grocy\Services\DatabaseService::class, 'DbConnection'))->setValue(null, $database);
    $http = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest(
        $request['method'], 'http://localhost/api/'
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
