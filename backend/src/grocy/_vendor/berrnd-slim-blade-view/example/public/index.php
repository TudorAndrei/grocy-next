<?php

require __DIR__ . '/../vendor/autoload.php';

// Slim Settings
$config = [
    'settings' => [
        'displayErrorDetails' => true, // set to false in production

        // Renderer settings
        'renderer'            => [
            'blade_template_path' => __DIR__ . '/../views', // String or array of multiple paths
            'blade_cache_path'    => __DIR__ . '/../cache', // Mandatory by default, though could probably turn caching off for development
        ],
    ],
];

// Create Slim app
$app = new \Slim\App($config);

// Fetch DI Container
$container = $app->getContainer();

// Register Blade View helper
$container['view'] = function ($container) {
    return new \Slim\Views\Blade(
        $container['settings']['renderer']['blade_template_path'],
        $container['settings']['renderer']['blade_cache_path']
    );
};

// Define named route
$app->get('/hello/{name}/', function ($request, $response, $args) {
    return $this->view->render($response, 'profile', [
        'name' => $args['name'],
    ]);
})->setName('profile');

// Run app
$app->run();
