// Configuración global de SweetAlert2 con la estética del sistema
const swalCustom = Swal.mixin({
    customClass: {
        confirmButton: 'btn btn-main',
        cancelButton: 'btn btn-secondary',
        denyButton: 'btn btn-danger',
        popup: 'rounded-4 shadow-lg',
        title: 'text-color',
        htmlContainer: 'text-dark'
    },
    buttonsStyling: false,
    confirmButtonColor: '#223a66',
    cancelButtonColor: '#6c757d',
    denyButtonColor: '#e12454'
});

// Función para mostrar mensajes de éxito
function mostrarExito(mensaje, titulo = '¡Éxito!') {
    swalCustom.fire({
        icon: 'success',
        title: titulo,
        text: mensaje,
        timer: 3000,
        showConfirmButton: true,
        confirmButtonText: 'Aceptar'
    });
}

// Función para mostrar mensajes de error
function mostrarError(mensaje, titulo = 'Error') {
    swalCustom.fire({
        icon: 'error',
        title: titulo,
        text: mensaje,
        confirmButtonText: 'Entendido'
    });
}

// Función para mostrar advertencias
function mostrarAdvertencia(mensaje, titulo = 'Atención') {
    swalCustom.fire({
        icon: 'warning',
        title: titulo,
        text: mensaje,
        confirmButtonText: 'Aceptar'
    });
}

// Función para confirmar acciones (eliminar, cancelar, etc.)
async function confirmarAccion(mensaje, titulo = '¿Estás seguro?', textoBotonConfirmar = 'Sí, continuar') {
    const result = await swalCustom.fire({
        icon: 'question',
        title: titulo,
        text: mensaje,
        showCancelButton: true,
        confirmButtonText: textoBotonConfirmar,
        cancelButtonText: 'Cancelar',
        reverseButtons: true
    });
    return result.isConfirmed;
}

// Función para mostrar loading
function mostrarLoading(mensaje = 'Procesando...') {
    swalCustom.fire({
        title: mensaje,
        allowOutsideClick: false,
        allowEscapeKey: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });
}

// Función para cerrar loading
function cerrarLoading() {
    Swal.close();
}

// Función para mensajes de información
function mostrarInfo(mensaje, titulo = 'Información') {
    swalCustom.fire({
        icon: 'info',
        title: titulo,
        text: mensaje,
        confirmButtonText: 'Entendido'
    });
}

// Función para mostrar mensaje de autocompletado (estilo toast)
function mostrarToast(mensaje, icono = 'success') {
    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        didOpen: (toast) => {
            toast.onmouseenter = Swal.stopTimer;
            toast.onmouseleave = Swal.resumeTimer;
        }
    });
    
    Toast.fire({
        icon: icono,
        title: mensaje
    });
}