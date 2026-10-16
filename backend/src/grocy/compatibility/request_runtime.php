<?php

// Runtime inputs use the pinned packages in ../_vendor. Each has its own license.
spl_autoload_register(function (string $class): void {
    $prefixes = [
        'DI\\' => ['php-di/src/'],
        'Invoker\\' => ['php-di-invoker/src/'],
        'Laravel\\SerializableClosure\\' => ['laravel-serializable-closure/src/'],
        'Grocy\\Services\\' => ['grocy-core/services/'],
        'Grocy\\Controllers\\' => ['grocy-core/controllers/'],
        'Grocy\\Middleware\\' => ['grocy-core/middleware/'],
        'Grocy\\Helpers\\' => ['grocy-core/helpers/'],
        'Mike42\\' => ['mike42-escpos-php/src/Mike42/', 'mike42-gfx-php/src/Mike42/'],
        'Eluceo\\iCal\\' => ['eluceo-ical/src/'],
        'Gettext\\Languages\\' => ['gettext-languages/src/'],
        'Gettext\\' => ['gettext-gettext/src/'],
        'GuzzleHttp\\Promise\\' => ['guzzlehttp-promises/src/'],
        'GuzzleHttp\\Psr7\\' => ['guzzlehttp-psr7/src/'],
        'GuzzleHttp\\' => ['guzzlehttp-guzzle/src/'],
        'FastRoute\\' => ['nikic-fast-route/src/'],
        'Psr\\Container\\' => ['psr-container/src/'],
        'Psr\\Log\\' => ['psr-log/src/'],
        'Psr\\Http\\Server\\' => ['psr-http-server-handler/src/', 'psr-http-server-middleware/src/'],
        'Psr\\Http\\Client\\' => ['psr-http-client/src/'],
        'Gumlet\\' => ['gumlet-image-resize/lib/'],
        'LessQL\\' => ['morris-lessql/src/LessQL/'],
        'Slim\\Http\\' => ['slim-http/src/'],
        'Slim\\Exception\\' => ['slim-framework/Slim/Exception/'],
        'Slim\\Psr7\\' => ['slim-psr7/src/'],
        'Slim\\' => ['slim-framework/Slim/'],
        'Psr\\Http\\Message\\' => ['psr-http-message/src/', 'psr-http-factory/src/'],
        'Fig\\Http\\Message\\' => ['fig-http-message-util/src/'],
    ];
    static $renderPackages = null;
    $renderPackages ??= json_decode(file_get_contents(__DIR__ . '/render_packages.json'), true);
    $prefixes = array_merge($renderPackages['prefixes'], $prefixes);
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
require __DIR__ . '/../_vendor/guzzlehttp-guzzle/src/functions_include.php';
require __DIR__ . '/../_vendor/symfony-deprecation-contracts/function.php';
require __DIR__ . '/native_classes.php';
require __DIR__ . '/../_vendor/nikic-fast-route/src/functions.php';
require __DIR__ . '/../_vendor/php-di/src/functions.php';
foreach (json_decode(file_get_contents(__DIR__ . '/render_packages.json'), true)['files'] as $file) {
    require __DIR__ . '/../_vendor/' . $file;
}

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
