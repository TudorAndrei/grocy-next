<?php

// Runtime inputs use the pinned packages in ../_vendor. Each has its own license.
spl_autoload_register(function (string $class): void {
    $prefixes = [
        'Grocy\\Services\\' => ['grocy-core/services/'],
        'Grocy\\Controllers\\' => ['grocy-core/controllers/'],
        'Gumlet\\' => ['gumlet-image-resize/lib/'],
        'LessQL\\' => ['morris-lessql/src/LessQL/'],
        'Slim\\Http\\' => ['slim-http/src/'],
        'Slim\\Exception\\' => ['slim-framework/Slim/Exception/'],
        'Slim\\Psr7\\' => ['slim-psr7/src/'],
        'Psr\\Http\\Message\\' => ['psr-http-message/src/', 'psr-http-factory/src/'],
        'Fig\\Http\\Message\\' => ['fig-http-message-util/src/'],
    ];
    foreach ($prefixes as $prefix => $directories) {
        if (!str_starts_with($class, $prefix)) {
            continue;
        }
        foreach ($directories as $directory) {
            $path = __DIR__ . '/../_vendor/' . $directory . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
            if (is_file($path)) {
                require $path;
                return;
            }
        }
    }
});
require __DIR__ . '/../_vendor/ralouphie-getallheaders/src/getallheaders.php';
require __DIR__ . '/../_vendor/grocy-core/helpers/extensions.php';

function parsedBody(string $raw, string $method, ?string $contentType)
{
    $request = (new Slim\Psr7\Factory\ServerRequestFactory())->createServerRequest($method, 'http://localhost/');
    $request = $request->withBody((new Slim\Psr7\Factory\StreamFactory())->createStream($raw));
    if ($contentType !== null) {
        $request = $request->withHeader('Content-Type', $contentType);
    }
    return (new Slim\Http\ServerRequest($request))->getParsedBody();
}

function filteredBody($body, HTMLPurifier $purifier)
{
    foreach ($body as &$value) {
        if (!is_bool($value) && !is_array($value)) {
            $value = $purifier->purify($value);
            $value = str_replace('&amp;', '&', $value);
            $value = str_replace('&gt;', '>', $value);
            $value = str_replace('&lt;', '<', $value);
        }
    }
    unset($value);
    return $body;
}
