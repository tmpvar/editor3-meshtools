var meshtools = {};

if (typeof require !== 'undefined') {
  var Vec2 = require('vec2');
}

var projector = new THREE.Projector();

meshtools.mouseIntersections = function(root, camera, vec2) {

  var vector = new THREE.Vector3(
    (vec2.x / camera.canvas.clientWidth) * 2 - 1,
    -(vec2.y / camera.canvas.clientHeight) * 2 + 1,
    .5
  );

  projector.unprojectVector( vector, camera );

  var raycaster = new THREE.Raycaster(
    camera.position,
    vector.sub( camera.position ).normalize()
  );


  var intersects = raycaster.intersectObject(root, true);
  return intersects;
};

meshtools.mouseIntersection = function(root, camera, vec2) {
  var intersects = meshtools.mouseIntersections(root, camera, vec2);

  if (intersects.length) {
    for (var i=0; i<intersects.length; i++) {
      if (!intersects[i].object.userData.ignoreRaycasts) {
        return intersects[i];
      }
    }
  }
  return null;
};


meshtools.mouseNgonHelperIntersection = function(root, camera, vec2) {
  var isects = meshtools.mouseIntersections(root, camera, vec2);

  return isects.filter(function(isect) {
    return isect.face && isect.face.ngonHelper;
  }).shift();
};

var num = function(a) {
  return parseFloat(Number(a).toFixed(6));
};

THREE.Vector3.prototype.clean = function() {
  this.set(
    Vec2.clean(this.x),
    Vec2.clean(this.y),
    Vec2.clean(this.z)
  );
  return this;
}

THREE.Vector3.prototype.near = function(b, threshold) {

  threshold = threshold || .000000001;

  var x = Math.abs(this.x - b.x);
  var y = Math.abs(this.y - b.y);
  var z = Math.abs(this.z - b.z);

  return (x < threshold && y < threshold && z < threshold);
};

var coplanarMatrix = new THREE.Matrix4();
meshtools.pointsCoplanar = function(a, b, c, d) {
  coplanarMatrix.set(
    a.x, a.y, a.z, 1,
    b.x, b.y, b.z, 1,
    c.x, c.y, c.z, 1,
    d.x, d.y, d.z, 1
  );

  return Math.abs(coplanarMatrix.determinant()) < 0.1;
};

meshtools.facesAreCoplanar = function(a, b, c, a2, b2, c2) {
  if (
    meshtools.pointsCoplanar(a, b, c, a2) &&
    meshtools.pointsCoplanar(a2, b2, c2, a)
  ) {
    return true;
  }
};

meshtools.computeCoplanarFaces = function(mesh) {
  var geometry = mesh.geometry || mesh;
  var faces = geometry.faces;
  var verts = geometry.vertices;
  var i, j;

  // First, lets collect the normals.  We can assume that
  // if the face normals don't match, then they are not
  // going to be coplanar

  // TODO PERF: I think if we sort by normal before this we can
  //            break early and avoid a ton of overhead

  var coplanar = [];
  for (i=0; i<faces.length; i++) {

    var combined = false;
    for (j=0; j<coplanar.length; j++) {
      if (coplanar[j][0].normal.near(faces[i].normal, .00001)) {

        // If the normals are matching then we have a candidate for
        // a coplanar match

        var res = meshtools.facesAreCoplanar(
          verts[faces[i].a],
          verts[faces[i].b],
          verts[faces[i].c],
          verts[coplanar[j][0].a],
          verts[coplanar[j][0].b],
          verts[coplanar[j][0].c]
        );

        if (res) {
          coplanar[j].push(faces[i]);
          combined = true;
          break;
        }
      }
    }

    if (!combined) {
      coplanar.push([faces[i]]);
    }
  }

  return coplanar;
};


meshtools.shapesToGeometry = function(shapes, amount, material) {
  // Extrude the geometry without bevel, by the specified amount
  var geometry = new THREE.ExtrudeGeometry(shapes, {
    amount: amount,
    bevelEnabled: false
  });

  var obj = new THREE.Mesh(
    geometry,
    material || new THREE.MeshLambertMaterial({
      color: 0xFFFFFF,
      shading: THREE.FlatShading,
      transparent: true,
      opacity: 1
    })
  );

  return obj;
}

meshtools.computeNgonHelpers = function(sourceMesh) {

  var faceGeometries = meshtools.computeCoplanarFaces(sourceMesh);

  for (var i = 0; i<faceGeometries.length; i++) {
    var obj = faceGeometries[i];
    var geometry = new THREE.Geometry();

    var mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x0086FF,
        transparent: true,
        opacity: .7,
        shading: THREE.FlatShading
      })
    );

    for (var j = 0; j<obj.length; j++) {

      var face = obj[j];
      var clone = face.clone();

      var zFighting = face.normal.clone().multiplyScalar(.01);

      clone.a = geometry.vertices.length;
      geometry.vertices.push(
        sourceMesh.geometry.vertices[face.a].clone().add(zFighting)
      );

      clone.b = geometry.vertices.length;
      geometry.vertices.push(
        sourceMesh.geometry.vertices[face.b].clone().add(zFighting)
      );

      clone.c = geometry.vertices.length;
      geometry.vertices.push(
        sourceMesh.geometry.vertices[face.c].clone().add(zFighting)
      );

      geometry.faces.push(clone);

      face.ngonHelper = mesh;
    };

    geometry.mergeVertices();
    geometry.computeVertexNormals();
    geometry.computeFaceNormals();
    geometry.computeCentroids();

    mesh.position.sub(THREE.GeometryUtils.center(mesh.geometry))

    mesh.doublesided = true;
    mesh.overdraw = true;
    mesh.targetObject = sourceMesh;

    mesh.userData.ignoreRaycasts = true;

    sourceMesh.add(mesh);
    mesh.visible = false;
  }
};

meshtools.createShape = function(obj, hole) {
  var points = obj.computeGeometry([], hole).map(function(point) {
    return new THREE.Vector2(point.x, point.y);
  });

  return new THREE.Shape(points);
};

meshtools.generateShapes = function(array) {
  array = array.concat();

  array.sort(function(a, b) {
    return (Math.abs(a.area()) > Math.abs(b.area())) ? -1 : 1;
  });

  var raw = new Array();

  for (var i = 0; i<array.length; i++) {
    var inner = array[i];

    for (var j = 0; j<raw.length; j++) {
      var outer = raw[j];
      if (outer.contains(inner)) {

        if (!outer.isHole) {
          inner.isHole = true;
        }

        inner.shape = meshtools.createShape(array[i], inner.isHole);
        outer.shape.holes.push(inner.shape);
        raw.unshift(inner);
        break;
      }
    }

    if (!inner.shape) {
      inner.shape = meshtools.createShape(array[i], false);
    }

    raw.unshift(inner);
  }

  return raw.filter(function(a) {
            return !a.isHole;
          }).map(function(a) {
            return a.shape;
          });
};

meshtools.alignWithPlane = function(obj, plane) {
  var rot = new THREE.Matrix4().extractRotation(plane.matrixWorld)

  // This will move the object's position so that the edge of the
  // extruded mesh touches the drawing plane
  obj.position.applyMatrix4(plane.matrixWorld);

  // rotate the object housing the extruded mesh
  // to match the drawing plane's normal
  obj.geometry.applyMatrix(rot);

  obj.geometry.castShadow = true;
  obj.geometry.receiveShadow = true;
  obj.geometry.computeCentroids();
  obj.geometry.computeFaceNormals();
  obj.geometry.computeVertexNormals();
};

if (typeof module !== "undefined" && typeof module.exports == "object") {
  module.exports = meshtools;
}

if (typeof window !== "undefined") {
  window.meshtools = window.meshtools || meshtools;
}
