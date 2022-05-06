"use strict"

// если нет поддержки WebGL - вывести сообщение
if ( ! Detector.webgl ) Detector.addGetWebGLMessage();

// функция настройки параметров наблюдателя
function Observer() {
    this.position = new THREE.Vector3(10,0,0);
    this.velocity = new THREE.Vector3(0,1,0);
    this.orientation = new THREE.Matrix3();
    this.time = 0.0;
}

// функция инициализации кадра орбиты для наблюдателя
Observer.prototype.orbitalFrame = function() {

    var orbital_y = (new THREE.Vector3())
        .subVectors(observer.velocity.clone().normalize().multiplyScalar(4.0),
            observer.position).normalize();

    var orbital_z = (new THREE.Vector3())
        .crossVectors(observer.position, orbital_y).normalize();
    var orbital_x = (new THREE.Vector3()).crossVectors(orbital_y, orbital_z);


    return (new THREE.Matrix4()).makeBasis(
        orbital_x,
        orbital_y,
        orbital_z
    ).linearPart();
};

// функция расчёта перемещения наблюдателя
Observer.prototype.move = function(dt) {

    dt *= shader.parameters.time_scale;

    var r;
    var v = 0;

    if (shader.parameters.observer.motion) {

        r = shader.parameters.observer.distance;
        v =  1.0 / Math.sqrt(2.0*(r-1.0));
        var ang_vel = v / r;
        var angle = this.time * ang_vel;

        var s = Math.sin(angle), c = Math.cos(angle);

        this.position.set(c*r, s*r, 0);
        this.velocity.set(-s*v, c*v, 0);

        var alpha = degToRad(shader.parameters.observer.orbital_inclination);
        var orbit_coords = (new THREE.Matrix4()).makeRotationY(alpha);

        this.position.applyMatrix4(orbit_coords);
        this.velocity.applyMatrix4(orbit_coords);
    }
    else {
        r = this.position.length();
    }

    if (shader.parameters.gravitational_time_dilation) {
        dt = Math.sqrt((dt*dt * (1.0 - v*v)) / (1-1.0/r));
    }

    this.time += dt;
};

// объявление основных глобальных переменных
var container, stats, isStats = false;
var camera, scene, renderer, cameraControls, shader = null;
var observer = new Observer();

// функция инициализации шейдера
function Shader(mustacheTemplate) {
    this.parameters = {
        n_steps: 100,
        quality: 'среднее',
        accretion_disk: true,
        planet: {
            enabled: true,
            distance: 7.0,
            radius: 0.4
        },
        lorentz_contraction: true,
        gravitational_time_dilation: true,
        aberration: true,
        beaming: true,
        doppler_shift: true,
        light_travel_time: true,
        time_scale: 1.0,
        observer: {
            motion: true,
            distance: 11.0,
            orbital_inclination: -10
        },

        planetEnabled: function() {
            return this.planet.enabled && this.quality !== 'низкое';
        },

        observerMotion: function() {
            return this.observer.motion;
        }
    };
    var that = this;
    this.needsUpdate = false;

    this.hasMovingParts = function() {
        return this.parameters.planet.enabled || this.parameters.observer.motion;
    };

    this.compile = function() {
        return Mustache.render(mustacheTemplate, that.parameters);
    };
}

// функция перевода градусов в радианы
function degToRad(a) { return Math.PI * a / 180.0; }

// функция загрузки текстур
(function(){
    var textures = {};

    function whenLoaded() {
        init(textures);
        $('#loader').hide();
        $('.initially-hidden').removeClass('initially-hidden');
        animate();
    }

    function checkLoaded() {
        if (shader === null) return;
        for (var key in textures) if (textures[key] === null) return;
        whenLoaded();
    }

    SHADER_LOADER.load(function(shaders) {
        shader = new Shader(shaders.raytracer.fragment);
        checkLoaded();
    });

    var texLoader = new THREE.TextureLoader();
    function loadTexture(symbol, filename, interpolation) {
        textures[symbol] = null;
        texLoader.load(filename, function(tex) {
            tex.magFilter = interpolation;
            tex.minFilter = interpolation;
            textures[symbol] = tex;
            checkLoaded();
        });
    }

    loadTexture('galaxy', 'img/milkyway.jpg', THREE.NearestFilter);
    loadTexture('spectra', 'img/spectra.png', THREE.LinearFilter);
    loadTexture('planet', 'img/planet.png', THREE.LinearFilter);
    loadTexture('stars', 'img/stars.png', THREE.LinearFilter);
    loadTexture('accretion_disk', 'img/accretion-disk.png', THREE.LinearFilter);
})();

var updateUniforms;

// функция инициализации текстур
function init(textures) {

    container = document.createElement( 'div' );
    document.body.appendChild( container );

    scene = new THREE.Scene();

    var geometry = new THREE.PlaneBufferGeometry( 2, 2 );

    var uniforms = {
        time: { type: "f", value: 0 },
        resolution: { type: "v2", value: new THREE.Vector2() },
        cam_pos: { type: "v3", value: new THREE.Vector3() },
        cam_x: { type: "v3", value: new THREE.Vector3() },
        cam_y: { type: "v3", value: new THREE.Vector3() },
        cam_z: { type: "v3", value: new THREE.Vector3() },
        cam_vel: { type: "v3", value: new THREE.Vector3() },

        planet_distance: { type: "f" },
        planet_radius: { type: "f" },

        star_texture: { type: "t", value: textures.stars },
        accretion_disk_texture: { type: "t",  value: textures.accretion_disk },
        galaxy_texture: { type: "t", value: textures.galaxy },
        planet_texture: { type: "t", value: textures.planet },
        spectrum_texture: { type: "t", value: textures.spectra }
    };

    updateUniforms = function() {
        uniforms.planet_distance.value = shader.parameters.planet.distance;
        uniforms.planet_radius.value = shader.parameters.planet.radius;

        uniforms.resolution.value.x = renderer.domElement.width;
        uniforms.resolution.value.y = renderer.domElement.height;

        uniforms.time.value = observer.time;
        uniforms.cam_pos.value = observer.position;

        var e = observer.orientation.elements;

        uniforms.cam_x.value.set(e[0], e[1], e[2]);
        uniforms.cam_y.value.set(e[3], e[4], e[5]);
        uniforms.cam_z.value.set(e[6], e[7], e[8]);

        function setVec(target, value) {
            uniforms[target].value.set(value.x, value.y, value.z);
        }

        setVec('cam_pos', observer.position);
        setVec('cam_vel', observer.velocity);
    };

    var material = new THREE.ShaderMaterial( {
        uniforms: uniforms,
        vertexShader: $('#vertex-shader').text(),
    });

    scene.updateShader = function() {
        material.fragmentShader = shader.compile();
        material.needsUpdate = true;
        shader.needsUpdate = true;
    };

    scene.updateShader();

    var mesh = new THREE.Mesh( geometry, material );
    scene.add( mesh );

    renderer = new THREE.WebGLRenderer();
    renderer.setPixelRatio( window.devicePixelRatio );
    container.appendChild( renderer.domElement );

    camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 1, 80000 );
    initializeCamera(camera);

    cameraControls = new THREE.OrbitControls( camera, renderer.domElement );
    cameraControls.target.set( 0, 0, 0 );
    cameraControls.addEventListener( 'change', updateCamera );
    updateCamera();

    onWindowResize();

    window.addEventListener( 'resize', onWindowResize, false );

    setupGUI();
}

// функция инициализации панели управления
function setupGUI() {

    var hint = $('#hint-text');
    var p = shader.parameters;

    function updateShader() {
        hint.hide();
        scene.updateShader();
    }

    var gui = new dat.GUI();

    gui.add(p, 'quality', ['низкое', 'среднее', 'высокое']).name('Качество').onChange(function (value) {
        $('.planet-controls').show();
        switch(value) {
        case 'низкое':
            p.n_steps = 40;
            $('.planet-controls').hide();
            break;
        case 'среднее':
            p.n_steps = 100;
            break;
        case 'высокое':
            p.n_steps = 200;
            break;
        }

        updateShader();
    });
    gui.add({is_show_stats: isStats}, 'is_show_stats').name('Мониторинг').onChange(function (value) {
        if (value) {
            stats = new Stats();
            stats.domElement.style.position = 'absolute';
            stats.domElement.style.top = '0px';
            container.appendChild( stats.domElement );
            $(stats.domElement).addClass('hidden-phone');
        }
        else {
            document.getElementById('stats').remove()
        }
        isStats = value
    });
    gui.add(p, 'accretion_disk').name('Аккреционный диск').onChange(updateShader);

    var folder = gui.addFolder('Наблюдатель');
    folder.add(p.observer, 'motion').name('Движение').onChange(function(motion) {
        updateCamera();
        updateShader();
        if (motion) {
            hint.text('Подвижное наблюдение. Используйте мышь для перемещения камеры');
        } else {
            hint.text('Стационарное наблюдение. Используйте мышь для перемещения по орбите');
        }
        hint.fadeIn();
    });
    folder.add(p.observer, 'distance').min(1.5).max(30).name('Расстояние').onChange(updateCamera);
    folder.open();

    folder = gui.addFolder('Планета');
    folder.add(p.planet, 'enabled').name('Включена').onChange(function(enabled) {
        updateShader();
        var controls = $('.indirect-planet-controls').show();
        if (enabled) controls.show();
        else controls.hide();
    });
    folder.add(p.planet, 'distance').name('Расстояние').min(1.5).onChange(updateUniforms);
    folder.add(p.planet, 'radius').min(0.01).max(2.0).name('Радиус').onChange(updateUniforms);
    $(folder.domElement).addClass('planet-controls');

    function setGuiRowClass(guiEl, klass) {
        $(guiEl.domElement).parent().parent().addClass(klass);
    }
    folder.open()

    folder = gui.addFolder('Релятивистские эффекты');
    folder.add(p, 'aberration').name('Аберрация').onChange(updateShader);
    folder.add(p, 'beaming').name('Свечение').onChange(updateShader);
    folder.add(p, 'doppler_shift').name('Доплеровский сдвиг').onChange(updateShader);
    setGuiRowClass(
        folder.add(p, 'gravitational_time_dilation').name('Замедление времени').onChange(updateShader),
        'planet-controls indirect-planet-controls');
    setGuiRowClass(
        folder.add(p, 'lorentz_contraction').name('Лоренцево сокращение').onChange(updateShader),
        'planet-controls indirect-planet-controls');

    folder.open();

    folder = gui.addFolder('Время');
    folder.add(p, 'light_travel_time').name('Скорость света').onChange(updateShader);
    folder.add(p, 'time_scale').min(0).name('Ускорение');
    folder.open()

    gui.width = 340

    window.addEventListener('keydown', function (event) {
        if (event.altKey && event.code === 'KeyM') {
            dat.GUI.toggleHide();
        }
    });
}

// обработчик события изменения размера окна
function onWindowResize( event ) {
    renderer.setSize( window.innerWidth, window.innerHeight );
    updateUniforms();
}

// функция инициализации камеры
function initializeCamera(camera) {

    var pitchAngle = 3.0, yawAngle = 0.0;

    camera.matrixWorldInverse.makeRotationX(degToRad(-pitchAngle));
    camera.matrixWorldInverse.multiply(new THREE.Matrix4().makeRotationY(degToRad(-yawAngle)));

    var m = camera.matrixWorldInverse.elements;

    camera.position.set(m[2], m[6], m[10]);
}

// функция обновления камеры
function updateCamera( event ) {

    var zoom_dist = camera.position.length();
    var m = camera.matrixWorldInverse.elements;
    var camera_matrix;

    if (shader.parameters.observer.motion) {
        camera_matrix = new THREE.Matrix3();
    }
    else {
        camera_matrix = observer.orientation;
    }

    camera_matrix.set(
        m[0], m[1], m[2],
        m[8], m[9], m[10],
        m[4], m[5], m[6]
    );

    if (shader.parameters.observer.motion) {

        observer.orientation = observer.orbitalFrame().multiply(camera_matrix);

    } else {

        var p = new THREE.Vector3(
            camera_matrix.elements[6],
            camera_matrix.elements[7],
            camera_matrix.elements[8]);

        var dist = shader.parameters.observer.distance;
        observer.position.set(-p.x*dist, -p.y*dist, -p.z*dist);
        observer.velocity.set(0,0,0);
    }
}

// функция вычисления расстояния Фробениуса
function frobeniusDistance(matrix1, matrix2) {
    var sum = 0.0;
    for (var i in matrix1.elements) {
        var diff = matrix1.elements[i] - matrix2.elements[i];
        sum += diff*diff;
    }
    return Math.sqrt(sum);
}

// функция анимации объектов
function animate() {
    requestAnimationFrame( animate );

    camera.updateMatrixWorld();
    camera.matrixWorldInverse.getInverse( camera.matrixWorld );

    if (shader.needsUpdate || shader.hasMovingParts() ||
        frobeniusDistance(camera.matrixWorldInverse, lastCameraMat) > 1e-10) {

        shader.needsUpdate = false;
        render();
        lastCameraMat = camera.matrixWorldInverse.clone();
    }

    if (isStats) {
        stats.update();
    }
}

var lastCameraMat = new THREE.Matrix4().identity();

// функция для расчёта продолжительности кадра
var getFrameDuration = (function() {
    var lastTimestamp = new Date().getTime();
    return function() {
        var timestamp = new Date().getTime();
        var diff = (timestamp - lastTimestamp) / 1000.0;
        lastTimestamp = timestamp;
        return diff;
    };
})();

// функция рендера объектов
function render() {
    observer.move(getFrameDuration());
    if (shader.parameters.observer.motion) updateCamera();
    updateUniforms();
    renderer.render( scene, camera );
}
