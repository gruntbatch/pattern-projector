const handleVert = `#include("src/handle.vert")`
const handleFrag = `#include("src/handle.frag")`;
const rulerVert = `#include("src/ruler.vert")`;
const rulerFrag = `#include("src/ruler.frag")`;

const map = (x: number, inMin: number, inMax: number, outMin: number, outMax: number): number => {
    return outMin + (outMax - outMin) * (x - inMin) / (inMax - inMin);
}

class Point {
    constructor(public x: number, public y: number) {
        this.x = x;
        this.y = y;
    }

    static map(x: Point, inMin: number, inMax: number, outMin: number, outMax: number): Point {
        return new Point(
            map(x.x, inMin, inMax, outMin, outMax),
            map(x.y, inMin, inMax, outMin, outMax)
        );
    }
}

class Vector3 {
    constructor(public x: number, public y: number, public z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
    }
}

class Matrix3 {
    constructor(public _: Array<number>) {
        this._ = _;
    }

    static adjugate(m: Matrix3): Matrix3 {
        const _ = m._;
        return new Matrix3([
            _[4] * _[8] - _[5] * _[7], _[2] * _[7] - _[1] * _[8], _[1] * _[5] - _[2] * _[4],
            _[5] * _[6] - _[3] * _[8], _[0] * _[8] - _[2] * _[6], _[2] * _[3] - _[0] * _[5],
            _[3] * _[7] - _[4] * _[6], _[1] * _[6] - _[0] * _[7], _[0] * _[4] - _[1] * _[3]
        ])
    }

    static mul(a: Matrix3, b: Matrix3): Matrix3 {
        let c = new Matrix3(new Array<number>(9));
        
        for (let i=0; i<3; i++) {
            for (let j=0; j<3; j++) {
                let sum = 0;
                for (let k=0; k<3; k++) {
                    sum += a._[3 * i + k] * b._[3 * k + j];
                }
                c._[3 * i + j] = sum;
            }
        }

        return c;
    }

    static mulVector3(m: Matrix3, v: Vector3): Vector3 {
        return new Vector3(
            m._[0] * v.x + m._[1] * v.y + m._[2] * v.z,
            m._[3] * v.x + m._[4] * v.y + m._[5] * v.z,
            m._[6] * v.x + m._[7] * v.y + m._[8] * v.z
        )
    }
}

class Matrix4 {
    public _: Float32Array;

    constructor(_: Array<number>) {
        this._ = new Float32Array(_);
    }

    static identity(): Matrix4 {
        return new Matrix4([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);
    }

    static model(position: Point, scale: number): Matrix4 {
        return new Matrix4([
            scale, 0, 0, 0,
            0, scale, 0, 0,
            0, 0, 1, 0,
            position.x, position.y, 0, 1
        ]);
    }

    static orthographic(x: number, y: number): Matrix4 {
        const left = x / -2.0;
        const right = x / 2.0;
        const bottom = y / -2.0;
        const top = y / 2.0;
        const far = -1000;
        const near = 1000;
        return new Matrix4([
            2.0 / (right - left), 0, 0, 0,
            0, 2.0 / (top - bottom), 0, 0,
            0, 0, -2.0 / (far - near), 0,
            -(right + left) / (right - left),
            -(top + bottom) / (top - bottom),
            -(far + near) / (far - near),
            1.0
        ]);
    }

    static translation(position: Point): Matrix4 {
        return Matrix4.model(position, 1);
    }

}

class Vertex {
    constructor(public position: Point, public uv: Point, public color: number[], public weight: number[]) {
        this.position = position;
        this.uv = uv;
        this.color = color;
        this.weight = weight;
    }
}

class Plane {
    constructor(public width: number, public height: number, public primitive: Primitive) {
        this.width = width;
        this.height = height;
        this.primitive = primitive;
    }

    computeProjection(p1: Point, p2: Point, p3: Point, p4: Point): Matrix3 {
        const basisToPoints = (p1: Point, p2: Point, p3: Point, p4: Point): Matrix3 => {
            const m = new Matrix3([
                p1.x, p2.x, p3.x,
                p1.y, p2.y, p3.y,
                1, 1, 1
            ]);
            const v = Matrix3.mulVector3(Matrix3.adjugate(m), new Vector3(p4.x, p4.y, 1));
            return Matrix3.mul(m, new Matrix3([
                v.x, 0, 0,
                0, v.y, 0,
                0, 0, v.z
            ]));
        }
        const s = basisToPoints(new Point(0, 0), new Point(this.width, 0), new Point(0, this.height), new Point(this.width, this.height));
        const d = basisToPoints(p1, p2, p3, p4);
        return Matrix3.mul(d, Matrix3.adjugate(s));
    }
}

class Primitive {
    constructor(public mode: number, public first: number, public count: number) {
        this.mode = mode;
        this.first = first;
        this.count = count;
    }
}

const FLOATS_PER_VERTEX = 12;
const MAX_VERTEX_COUNT = 8192;

class Renderer {
    vertexCount: number;
    vertices: Float32Array;

    constructor(private gl: WebGL2RenderingContext, width: number, height: number) {
        this.gl = gl;

        // gl.clearColor(1, 0, 0, 1);
        // gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.viewport(0, 0, width, height);

        // Create the matrix uniform buffer
        {
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buffer);

            const data = new Float32Array(48);
            data.set(Matrix4.orthographic(width, height)._, 0);
            data.set(Matrix4.identity()._, 16);
            data.set(Matrix4.model(new Point(0, 0), 1)._, 32);
            gl.bufferData(gl.UNIFORM_BUFFER, data, gl.STATIC_DRAW);
        }

        // Create vertex buffer
        {
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                4 * FLOATS_PER_VERTEX * MAX_VERTEX_COUNT,
                gl.STATIC_DRAW
            );

            // Position
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 48, 0);
            gl.enableVertexAttribArray(0);

            // UV
            gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 48, 8);
            gl.enableVertexAttribArray(1);  

            // Color
            gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 48, 16);
            gl.enableVertexAttribArray(2); 

            // Weight
            gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 48, 32);
            gl.enableVertexAttribArray(3);
        }

        this.vertexCount = 0
        this.vertices = new Float32Array(FLOATS_PER_VERTEX * MAX_VERTEX_COUNT);
    }

    setProjectionMatrix(matrix: Matrix4) {
        this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 0, matrix._);
    }

    setViewMatrix(matrix: Matrix4) {
        this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 4 * 16, matrix._);
    }

    setModelMatrix(matrix: Matrix4) {
        this.gl.bufferSubData(this.gl.UNIFORM_BUFFER, 4 * 32, matrix._);
    }

    uploadVertices() {
        this.gl.bufferSubData(this.gl.ARRAY_BUFFER, 0, this.vertices, 0, FLOATS_PER_VERTEX * this.vertexCount);
    }

    createProgram(vert: string, frag: string): WebGLProgram {
        const gl = this.gl;

        const vertShader = gl.createShader(gl.VERTEX_SHADER)!;
        gl.shaderSource(vertShader, vert);
        gl.compileShader(vertShader);
    
        const fragShader = gl.createShader(gl.FRAGMENT_SHADER)!;
        gl.shaderSource(fragShader, frag);
        gl.compileShader(fragShader);
    
        const program = gl.createProgram()!;
        gl.attachShader(program, vertShader);
        gl.attachShader(program, fragShader);
        gl.linkProgram(program);

        const index = gl.getUniformBlockIndex(program, "Matrices");
        gl.uniformBlockBinding(program, index, 0);

        return program;
    }

    useProgram(program: WebGLProgram) {
        this.gl.useProgram(program);
    }

    private copyVerticesToBuffer(vertices: Array<Vertex>) {
        for (let i=0; i<vertices.length; i++, this.vertexCount++) {
            const vertex = vertices[i];
            const index = this.vertexCount * FLOATS_PER_VERTEX;
            this.vertices[index     ] = vertex.position.x;
            this.vertices[index +  1] = vertex.position.y;
            
            this.vertices[index +  2] = vertex.uv.x;
            this.vertices[index +  3] = vertex.uv.y;

            this.vertices[index +  4] = vertex.color[0];
            this.vertices[index +  5] = vertex.color[1];
            this.vertices[index +  6] = vertex.color[2];
            this.vertices[index +  7] = vertex.color[3];

            this.vertices[index +  8] = vertex.weight[0];
            this.vertices[index +  9] = vertex.weight[1];
            this.vertices[index + 10] = vertex.weight[2];
            this.vertices[index + 11] = vertex.weight[3];
        }
    }

    private newPlaneUsingFunction(width: number, height: number, resolution: number, func: (position: Point) => Vertex): Plane {
        const vertexCount = 6 * resolution * resolution;
        const vertices = new Array<Vertex>(vertexCount);

        for (let x=0; x<resolution; x++) {
            for (let y=0; y<resolution; y++) {
                const xres = (x / resolution);
                const x1res = ((x + 1) / resolution);
                const yres = (y / resolution);
                const y1res = ((y + 1) / resolution);

                const nw = func(new Point(xres, yres));
                const ne = func(new Point(x1res, yres));
                const se = func(new Point(x1res, y1res));
                const sw = func(new Point(xres, y1res));

                const index = 6 * (x + y * resolution);

                vertices[index    ] = nw;
                vertices[index + 1] = sw;
                vertices[index + 2] = se;

                vertices[index + 3] = nw;
                vertices[index + 4] = se;
                vertices[index + 5] = ne;
            }
        }

        const first = this.vertexCount;
        const count = vertexCount;
        this.copyVerticesToBuffer(vertices);
        // return new Primitive(this.gl.TRIANGLES, first, count);
        return new Plane(
            width,
            height,
            new Primitive(this.gl.TRIANGLES, first, count)
        );
    }

    private randomColor(): number[] {
        return [Math.random(), Math.random(), Math.random(), 1];
    }

    // createPlane(resolution: number): Primitive {
    //     return this.newPlaneUsingFunction(resolution, (position: Point): Vertex => {
    //         const mappedPosition = Point.map(position, 0, 1, -1, 1);
    //         return new Vertex(
    //             mappedPosition,
    //             position,
    //             this.randomColor(),
    //             [mappedPosition.x, mappedPosition.y, 1, 1]
    //         );
    //     });
    // }

    newPlane(width: number, height: number, resolution: number): Plane {
        return this.newPlaneUsingFunction(width, height, resolution, (position: Point): Vertex => {
            const mappedPosition = Point.map(position, 0, 1, -1, 1);
            return new Vertex(
                mappedPosition,
                position,
                this.randomColor(),
                [mappedPosition.x, mappedPosition.y, 1, 1]
            );
        });
        // return new Plane(width, height, null);
    }

    drawPrimitive(primitive: Primitive) {
        this.gl.drawArrays(primitive.mode, primitive.first, primitive.count);
    }
}

(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;

    const canvas = document.getElementById("canvas")! as HTMLCanvasElement;
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext("webgl2")!;

    const renderer = new Renderer(gl, width, height);

    const rulerProgram = renderer.createProgram(rulerVert, rulerFrag);
    renderer.useProgram(rulerProgram);

    const rulerPlane = renderer.newPlane(1, 1, 2);
    renderer.uploadVertices();

    renderer.setModelMatrix(Matrix4.model(new Point(200, 200), 200));
    renderer.drawPrimitive(rulerPlane.primitive);

    let handles = new Array<Point>(
        new Point(-100, -100),
        new Point(100, -100),
        new Point(-100, 100),
        new Point(100, 100)
    );
    let currentHandle = -1;

    const update = () => {
        {
            const w = rulerPlane.width;
            const h = rulerPlane.height;
            const t = rulerPlane.computeProjection(handles[0], handles[1], handles[2], handles[3]);
            const _ = t._;
            for (let i=0; i<9; i++) {
                _[i] = _[i] / _[8];
            }
            const t2 = new Matrix4([
                _[0], _[3], 0, _[6],
                _[1], _[4], 0, _[7],
                   0,    0, 1,    0,
                _[2], _[5], 0, _[8],
            ])
            console.log(t2);
            renderer.setModelMatrix(Matrix4.model(new Point(0, 0), 2));
            renderer.setViewMatrix(t2);
            renderer.drawPrimitive(rulerPlane.primitive);
        }
    }

    update();

    const move = (e: MouseEvent) => {
        if (currentHandle < 0) {
            return;
        }
        handles[currentHandle] = new Point(e.pageX - (width / 2), (height / 2) - e.pageY);
        update();
    }

    window.onmousedown = (e: MouseEvent) => {
        console.log("!!!");
        let x = e.pageX - (width / 2);
        let y = (height / 2) - e.pageY;
        console.log(x, y);
        let best = 400; // 20px squared
        currentHandle = -1;
        for (let i=0; i<4; i++) {
            console.log(handles[i].x, handles[i].y);
            let dx = x - handles[i].x;
            let dy = y - handles[i].y;
            let distanceSquared = dx * dx + dy * dy;
            if (best > distanceSquared) {
                best = distanceSquared;
                currentHandle = i;
            }
        }
        move(e);
    }
    window.onmouseup = () => {
        currentHandle = -1;
    }
    window.onmousemove = move;
})()